use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use crate::{
    hashing::hash_match_id,
    models::{BackendEventDetails, BackendEventPayload, ValorantGameMode, ValorantLocalState},
    process_detection::{detect_processes, ProcessSignals},
    riot_local_client::{DuoParty, RiotLocalClient},
    riot_lockfile::read_lockfile,
};

const CURRENT_GAME_COOLDOWN: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, PartialEq)]
pub struct DetectionSnapshot {
    pub state: ValorantLocalState,
    pub game_mode: ValorantGameMode,
    pub confidence: f64,
    pub match_id_hash: Option<String>,
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
            region: "unknown".into(),
            shard: "unknown".into(),
            evidence: vec!["simulation".into()],
            processes: ProcessSignals::default(),
            lockfile_found: false,
        }
    }

    pub fn to_payload(&self) -> BackendEventPayload {
        BackendEventPayload {
            source: "local_companion".into(),
            state: self.state.clone(),
            game_mode: self.game_mode.clone(),
            confidence: self.confidence,
            match_id_hash: self.match_id_hash.clone(),
            details: BackendEventDetails {
                detection_method: "riot_local_readonly".into(),
                region: self.region.clone(),
                shard: self.shard.clone(),
                evidence: self.evidence.clone(),
            },
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

pub async fn detect_current_party() -> Result<DuoParty, String> {
    let processes = detect_processes();
    if !processes.riot_client_running {
        return Ok(DuoParty {
            in_party: false,
            members: Vec::new(),
        });
    }
    let Some(lockfile) = read_lockfile()? else {
        return Ok(DuoParty {
            in_party: false,
            members: Vec::new(),
        });
    };
    let client = RiotLocalClient::new(lockfile)?;
    let context = client.session_context().await?;
    client.get_current_party(&context).await
}

pub async fn detect_once() -> Result<DetectionSnapshot, String> {
    let processes = detect_processes();
    if !processes.riot_client_running {
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::NotRunning,
            game_mode: ValorantGameMode::Unknown,
            confidence: 0.95,
            match_id_hash: None,
            region: "unknown".into(),
            shard: "unknown".into(),
            evidence: vec!["riot_client_process_not_found".into()],
            processes,
            lockfile_found: false,
        });
    }

    let Some(lockfile) = read_lockfile()? else {
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::Unknown,
            game_mode: ValorantGameMode::Unknown,
            confidence: 0.35,
            match_id_hash: None,
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
    let client = RiotLocalClient::new(lockfile)?;
    let context = client.session_context().await?;
    let mut evidence = vec!["riot_lockfile_present".into(), "local_session_found".into()];
    if let Some(signal) = client.get_current_game_match(&context).await? {
        evidence.push("current_game_match_id_found".into());
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::CurrentGame,
            game_mode: signal.game_mode,
            confidence: 0.95,
            match_id_hash: Some(hash_match_id(&signal.match_id)),
            region: context.region_shard.region,
            shard: context.region_shard.shard,
            evidence,
            processes,
            lockfile_found: true,
        });
    }
    if let Some(signal) = client.get_pregame_match(&context).await? {
        evidence.push("pregame_match_id_found".into());
        return Ok(DetectionSnapshot {
            state: ValorantLocalState::PreGame,
            game_mode: signal.game_mode,
            confidence: 0.85,
            match_id_hash: Some(hash_match_id(&signal.match_id)),
            region: context.region_shard.region,
            shard: context.region_shard.shard,
            evidence,
            processes,
            lockfile_found: true,
        });
    }
    evidence.push("no_active_match_found".into());
    Ok(DetectionSnapshot {
        state: if processes.valorant_running {
            ValorantLocalState::Menus
        } else {
            ValorantLocalState::NotRunning
        },
        game_mode: ValorantGameMode::Unknown,
        confidence: 0.7,
        match_id_hash: None,
        region: context.region_shard.region,
        shard: context.region_shard.shard,
        evidence,
        processes,
        lockfile_found: true,
    })
}
