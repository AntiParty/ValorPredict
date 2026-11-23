use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use crate::{
    hashing::hash_match_id,
    metrics::DetectionMetrics,
    models::{ValorantGameMode, ValorantLocalState},
    process_detection::{ProcessDetector, ProcessSignals},
    riot_local_client::RiotLocalClient,
    riot_lockfile::{default_lockfile_path, read_lockfile, Lockfile},
    riot_session::{same_session, RiotSession, SessionKey},
};

const CURRENT_GAME_COOLDOWN: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, PartialEq)]
pub struct DetectionSnapshot {
    pub state: ValorantLocalState,
    pub game_mode: ValorantGameMode,
    pub confidence: f64,
    pub match_id_hash: Option<String>,
    /// Raw Valorant match id, kept in-process only (never serialized out) so the
    /// match result can be read back for auto-resolution. `None` outside a match.
    pub match_id_raw: Option<String>,
    pub region: String,
    pub shard: String,
    pub evidence: Vec<String>,
    pub processes: ProcessSignals,
    pub lockfile_found: bool,
}

impl DetectionSnapshot {
    pub fn simulated(
        state: ValorantLocalState,
        game_mode: ValorantGameMode,
        match_id_hash: Option<String>,
        confidence: f64,
    ) -> Self {
        Self {
            state,
            game_mode,
            confidence,
            match_id_hash,
            match_id_raw: None,
            region: "unknown".into(),
            shard: "unknown".into(),
            evidence: vec!["simulation".into()],
            processes: ProcessSignals::default(),
            lockfile_found: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DetectionDecision {
    Send(DetectionSnapshot),
    Suppress,
}

#[derive(Default)]
pub struct DetectorMemory {
    last_state: Option<ValorantLocalState>,
    last_hash: Option<String>,
    current_game_sent_at: HashMap<String, Instant>,
    missing_game_polls: u8,
}

impl DetectorMemory {
    pub fn evaluate(&mut self, snapshot: &DetectionSnapshot, now: Instant) -> DetectionDecision {
        if snapshot.state == ValorantLocalState::CurrentGame {
            self.missing_game_polls = 0;
            if let Some(hash) = &snapshot.match_id_hash {
                if self
                    .current_game_sent_at
                    .get(hash)
                    .is_some_and(|sent| now.duration_since(*sent) < CURRENT_GAME_COOLDOWN)
                {
                    return DetectionDecision::Suppress;
                }
                self.current_game_sent_at.insert(hash.clone(), now);
            }
            if self.last_state.as_ref() == Some(&snapshot.state)
                && self.last_hash == snapshot.match_id_hash
            {
                return DetectionDecision::Suppress;
            }
            self.remember(snapshot);
            return DetectionDecision::Send(snapshot.clone());
        }

        if matches!(
            self.last_state,
            Some(ValorantLocalState::CurrentGame | ValorantLocalState::PreGame)
        ) && matches!(
            snapshot.state,
            ValorantLocalState::Menus | ValorantLocalState::Unknown
        ) {
            self.missing_game_polls += 1;
            if self.missing_game_polls < 2 {
                return DetectionDecision::Suppress;
            }
        } else {
            self.missing_game_polls = 0;
        }

        if self.last_state.as_ref() == Some(&snapshot.state)
            && self.last_hash == snapshot.match_id_hash
        {
            return DetectionDecision::Suppress;
        }
        self.remember(snapshot);
        DetectionDecision::Send(snapshot.clone())
    }

    fn remember(&mut self, snapshot: &DetectionSnapshot) {
        self.last_state = Some(snapshot.state.clone());
        self.last_hash = snapshot.match_id_hash.clone();
    }
}

/// Should this poll talk to the Riot Client at all? Only while VALORANT is
/// running; the Riot Client alone (open all day for other games) is not enough.
pub fn needs_riot_session(processes: ProcessSignals) -> bool {
    processes.riot_client_running && processes.valorant_running
}

/// Looking up a finished match's result is allowed without VALORANT running
/// (players quit right after a game) as long as the Riot Client is up and we
/// already hold a session from the match, so no loopback calls are needed.
pub fn can_fetch_result(processes: ProcessSignals, has_cached_session: bool) -> bool {
    processes.riot_client_running && (processes.valorant_running || has_cached_session)
}

/// How long to wait before the next poll, by what the last poll saw.
///
/// | state                                   | delay |
/// | --------------------------------------- | ----- |
/// | VALORANT not running                    | 20 s  |
/// | menus (and unknown)                     | 15 s  |
/// | agent select                            | 5 s   |
/// | in a match                              | 20 s  |
/// | out of a match, result still pending    | 10 s  |
pub fn next_poll_delay(state: &ValorantLocalState, has_active_match: bool) -> Duration {
    let seconds = match state {
        ValorantLocalState::PreGame => 5,
        ValorantLocalState::CurrentGame => 20,
        _ if has_active_match => 10,
        ValorantLocalState::NotRunning => 20,
        ValorantLocalState::Menus
        | ValorantLocalState::Unknown
        | ValorantLocalState::PostGame => 15,
    };
    Duration::from_secs(seconds)
}

/// What the detection loop keeps between polls.
pub struct DetectorRuntime {
    pub processes: ProcessDetector,
    session: Option<RiotSession>,
    metrics: Arc<DetectionMetrics>,
}

impl DetectorRuntime {
    pub fn new(metrics: Arc<DetectionMetrics>) -> Self {
        Self {
            processes: ProcessDetector::with_metrics(metrics.clone()),
            session: None,
            metrics,
        }
    }

    /// Reuse the cached session if it matches the current lockfile (and the
    /// running VALORANT), otherwise build a new one.
    async fn session_for(&mut self, lockfile: Lockfile) -> Result<&mut RiotSession, String> {
        let key = SessionKey::new(&lockfile, self.processes.valorant_pid());
        let reusable = self
            .session
            .as_ref()
            .is_some_and(|session| !session.needs_rebuild() && same_session(session.key(), &key));
        if !reusable {
            self.session = None;
            let client = RiotLocalClient::new(lockfile, self.metrics.clone())?;
            self.session = Some(RiotSession::open(key, client).await?);
        }
        self.session
            .as_mut()
            .ok_or_else(|| "Riot session is unavailable.".to_string())
    }
}

/// Read whether the local player's team won `match_id`. Returns `Ok(None)` when
/// the result isn't available yet (Riot is still finalizing the match) so the
/// caller can retry on a later poll.
pub async fn fetch_match_won(
    match_id: &str,
    runtime: &mut DetectorRuntime,
) -> Result<Option<bool>, String> {
    let processes = runtime.processes.detect();
    if !can_fetch_result(processes, runtime.session.is_some()) {
        return Ok(None);
    }
    let Some(lockfile) = read_lockfile()? else {
        return Ok(None);
    };
    runtime
        .session_for(lockfile)
        .await?
        .match_result(match_id)
        .await
}

/// The snapshot for a poll that never needed Riot: Riot Client or VALORANT
/// isn't running. `lockfile_found` is only for Diagnostics.
pub fn idle_snapshot(processes: ProcessSignals, lockfile_found: bool) -> DetectionSnapshot {
    let reason = if processes.riot_client_running {
        "valorant_process_not_found"
    } else {
        "riot_client_process_not_found"
    };
    DetectionSnapshot {
        state: ValorantLocalState::NotRunning,
        game_mode: ValorantGameMode::Unknown,
        confidence: 0.95,
        match_id_hash: None,
        match_id_raw: None,
        region: "unknown".into(),
        shard: "unknown".into(),
        evidence: vec![reason.into()],
        processes,
        lockfile_found,
    }
}

pub async fn detect_once(runtime: &mut DetectorRuntime) -> Result<DetectionSnapshot, String> {
    let processes = runtime.processes.detect();
    if !needs_riot_session(processes) {
        let lockfile_found = processes.riot_client_running
            && default_lockfile_path().is_some_and(|path| path.exists());
        return Ok(idle_snapshot(processes, lockfile_found));
    }

    let Some(lockfile) = read_lockfile()? else {
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::Unknown,
            game_mode: ValorantGameMode::Unknown,
            confidence: 0.35,
            match_id_hash: None,
            match_id_raw: None,
            region: "unknown".into(),
            shard: "unknown".into(),
            evidence: vec![
                "riot_client_running".into(),
                "riot_lockfile_not_found".into(),
            ],
            processes,
            lockfile_found: false,
        });
    };
    let session = runtime.session_for(lockfile).await?;
    let mut evidence = vec!["riot_lockfile_present".into(), "local_session_found".into()];
    if let Some(signal) = session.current_game().await? {
        evidence.push("current_game_match_id_found".into());
        let region_shard = session.context().region_shard.clone();
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::CurrentGame,
            game_mode: signal.game_mode,
            confidence: 0.95,
            match_id_hash: Some(hash_match_id(&signal.match_id)),
            match_id_raw: Some(signal.match_id.clone()),
            region: region_shard.region,
            shard: region_shard.shard,
            evidence,
            processes,
            lockfile_found: true,
        });
    }
    if let Some(signal) = session.pregame().await? {
        evidence.push("pregame_match_id_found".into());
        let region_shard = session.context().region_shard.clone();
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::PreGame,
            game_mode: signal.game_mode,
            confidence: 0.85,
            match_id_hash: Some(hash_match_id(&signal.match_id)),
            match_id_raw: Some(signal.match_id.clone()),
            region: region_shard.region,
            shard: region_shard.shard,
            evidence,
            processes,
            lockfile_found: true,
        });
    }
    evidence.push("no_active_match_found".into());
    let region_shard = session.context().region_shard.clone();
    Ok(DetectionSnapshot {
        state: ValorantLocalState::Menus,
        game_mode: ValorantGameMode::Unknown,
        confidence: 0.7,
        match_id_hash: None,
        match_id_raw: None,
        region: region_shard.region,
        shard: region_shard.shard,
        evidence,
        processes,
        lockfile_found: true,
    })
}
