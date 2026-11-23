use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use tauri::State;
use tokio::sync::Notify;

use vap_core::db::Db;
use vap_core::predictions::Winner;

use crate::{
    metrics::DetectionMetricsView,
    models::{
        clamp_poll_interval, AppSettings, BackendResponse, LogEntry, SettingsView,
        ValorantDetectionStatus, ValorantGameMode, ValorantLocalState,
    },
    predictions::{restore_runtime, PredictionRuntime},
    settings::SettingsStore,
    shared::Shared,
    valorant_detector::{
        detect_once, fetch_match_won, next_poll_delay, DetectionDecision, DetectorMemory,
        DetectorRuntime,
    },
};

/// A match we opened a prediction for and are waiting to auto-resolve once it
/// ends.
struct ActiveMatch {
    match_id: String,
    game_mode: ValorantGameMode,
    /// When we first saw the match no longer live. The result lookup is retried
    /// until `RESOLVE_DEADLINE` after this.
    ended_at: Option<Instant>,
}

/// How long after a match ends we keep trying to read its result before giving
/// up and leaving the prediction for the streamer to resolve manually.
pub const RESOLVE_DEADLINE: Duration = Duration::from_secs(10 * 60);

/// A monitor loop keeps running only while monitoring is on and no newer start replaced it.
pub fn is_current_loop(monitoring: &AtomicBool, generation: &AtomicU64, mine: u64) -> bool {
    monitoring.load(Ordering::SeqCst) && generation.load(Ordering::SeqCst) == mine
}

pub fn resolve_deadline_passed(ended_at: Instant, now: Instant) -> bool {
    now.saturating_duration_since(ended_at) >= RESOLVE_DEADLINE
}

const CURRENT_GAME_COOLDOWN_SECONDS: u64 = 600;

pub struct AppRuntimeState {
    pub settings: Arc<Mutex<AppSettings>>,
    /// Detection status, logs, counters and UI notifications.
    pub shared: Arc<Shared>,
    pub settings_store: SettingsStore,
    pub monitoring: Arc<AtomicBool>,
    /// Wakes the monitoring loop's sleep when monitoring is stopped.
    stop_signal: Arc<Notify>,
    /// Bumped on every start so a loop from an earlier start can tell it is stale.
    generation: Arc<AtomicU64>,
    /// Local SQLite-backed prediction store (replaces the remote backend).
    pub db: Arc<Db>,
    /// Twitch client + prediction service, present once credentials are saved.
    pub predictions: Arc<RwLock<Option<PredictionRuntime>>>,
}

impl AppRuntimeState {
    pub fn new(settings_store: SettingsStore, db: Arc<Db>) -> Self {
        let settings = settings_store.load().unwrap_or_default();
        ensure_presets_for_existing_user(&db);
        let predictions = restore_runtime(&db);
        Self {
            settings: Arc::new(Mutex::new(settings)),
            shared: Arc::new(Shared::new()),
            settings_store,
            monitoring: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(Notify::new()),
            generation: Arc::new(AtomicU64::new(0)),
            db,
            predictions: Arc::new(RwLock::new(predictions)),
        }
    }
}

/// `get_dashboard` is read-only, so accounts created before presets were made
/// at connect time get theirs once, at startup.
pub fn ensure_presets_for_existing_user(db: &Db) {
    if let Ok(Some(user)) = db.get_user() {
        let _ = db.ensure_default_presets(&user.twitch_user_id);
    }
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppRuntimeState>) -> SettingsView {
    SettingsView::from(&*state.settings.lock())
}

/// Kept for old callers; `poll_interval_seconds` is stored but no longer used,
/// because poll timing is automatic.
#[tauri::command]
pub fn save_settings(
    state: State<'_, AppRuntimeState>,
    poll_interval_seconds: u64,
) -> Result<SettingsView, String> {
    let mut current = state.settings.lock();
    current.poll_interval_seconds = clamp_poll_interval(poll_interval_seconds);
    state.settings_store.save(&current)?;
    state.shared.push_log("info", "Settings saved.");
    Ok(SettingsView::from(&*current))
}

/// Read-only: the cooldown is computed from a stored deadline.
#[tauri::command]
pub fn get_status(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    state.shared.status()
}

#[tauri::command]
pub fn get_logs(state: State<'_, AppRuntimeState>) -> Vec<LogEntry> {
    state.shared.logs()
}

#[tauri::command]
pub fn get_detection_metrics(state: State<'_, AppRuntimeState>) -> DetectionMetricsView {
    state.shared.metrics.view()
}

pub fn should_auto_start_monitoring(settings: &AppSettings) -> bool {
    // Local mode: the monitoring loop itself guards on a connected Twitch
    // account, so the only stored preference we need is "was it running?".
    settings.monitoring_enabled
}

#[tauri::command]
pub fn start_monitoring(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    begin_monitoring(&state)
}

pub fn begin_monitoring(state: &AppRuntimeState) -> ValorantDetectionStatus {
    set_monitoring_preference(state, true);
    if state.monitoring.swap(true, Ordering::SeqCst) {
        return state.shared.status();
    }
    let my_generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let generation = state.generation.clone();
    state.shared.update_status(|status| status.monitoring = true);
    state.shared.push_log(
        "info",
        "Read-only Riot monitoring started. Predictions run locally on this PC.",
    );
    let shared = state.shared.clone();
    let db = state.db.clone();
    let predictions = state.predictions.clone();
    let monitoring = state.monitoring.clone();
    let stop_signal = state.stop_signal.clone();
    tauri::async_runtime::spawn(async move {
        let mut memory = DetectorMemory::default();
        let mut runtime = DetectorRuntime::new(shared.metrics.clone());
        let mut active_match: Option<ActiveMatch> = None;
        let mut last_state = ValorantLocalState::Unknown;
        let current = || is_current_loop(&monitoring, &generation, my_generation);
        while current() {
            let started = Instant::now();
            match detect_once(&mut runtime).await {
                Ok(snapshot) => {
                    last_state = snapshot.state.clone();
                    shared.update_status(|current| {
                        current.riot_lockfile_found = snapshot.lockfile_found;
                        current.riot_client_running = snapshot.processes.riot_client_running;
                        current.valorant_running = snapshot.processes.valorant_running;
                        current.region = snapshot.region.clone();
                        current.shard = snapshot.shard.clone();
                        current.local_state = snapshot.state.clone();
                        current.game_mode = snapshot.game_mode.clone();
                        current.confidence = snapshot.confidence;
                        current.last_match_id_hash = snapshot.match_id_hash.clone();
                    });

                    if snapshot.state == ValorantLocalState::CurrentGame {
                        // Still live (e.g. after a brief blip): restart the clock.
                        if let Some(active) = active_match.as_mut() {
                            if snapshot.match_id_raw.as_deref() == Some(active.match_id.as_str()) {
                                active.ended_at = None;
                            }
                        }
                    }

                    // A match we opened a prediction for has ended -> resolve it
                    // from the result. Uses the raw poll state, not the deduped
                    // decision, so we react as soon as the game is no longer live.
                    if active_match.is_some() && snapshot.state != ValorantLocalState::CurrentGame {
                        try_auto_resolve(
                            &db,
                            &predictions,
                            &shared,
                            &mut active_match,
                            &mut runtime,
                        )
                        .await;
                    }

                    if let DetectionDecision::Send(decided) =
                        memory.evaluate(&snapshot, Instant::now())
                    {
                        // The only locally-actionable transition is a match
                        // going live; other state changes just refresh the UI.
                        if decided.state == ValorantLocalState::CurrentGame {
                            let created = trigger_local_prediction(
                                &db,
                                &predictions,
                                &shared,
                                &decided.game_mode,
                            )
                            .await;
                            shared.start_cooldown(CURRENT_GAME_COOLDOWN_SECONDS);
                            if created {
                                if let Some(match_id) = decided.match_id_raw.clone() {
                                    active_match = Some(ActiveMatch {
                                        match_id,
                                        game_mode: decided.game_mode.clone(),
                                        ended_at: None,
                                    });
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    shared.push_log("error", &error);
                }
            }
            shared.metrics.record_poll(started.elapsed());
            let delay = next_poll_delay(&last_state, active_match.is_some());
            if !current() {
                break;
            }
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                _ = stop_signal.notified() => {}
            }
        }
        // A newer loop owns the status now; don't overwrite it or log a stop.
        if generation.load(Ordering::SeqCst) == my_generation {
            shared.update_status(|status| status.monitoring = false);
            shared.push_log("info", "Read-only Riot monitoring stopped.");
        }
    });
    state.shared.status()
}

#[tauri::command]
pub fn stop_monitoring(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    end_monitoring(&state)
}

pub fn end_monitoring(state: &AppRuntimeState) -> ValorantDetectionStatus {
    set_monitoring_preference(state, false);
    state.monitoring.store(false, Ordering::SeqCst);
    // No stored permit: a stop with nobody waiting must not skip the next loop's first sleep.
    state.stop_signal.notify_waiters();
    state.shared.update_status(|status| status.monitoring = false);
    state.shared.status()
}

fn set_monitoring_preference(state: &AppRuntimeState, enabled: bool) {
    let mut settings = state.settings.lock();
    settings.monitoring_enabled = enabled;
    if let Err(error) = state.settings_store.save(&settings) {
        state.shared.push_log(
            "error",
            &format!("Could not remember monitoring preference: {error}"),
        );
    }
}

/// Turn a detected (or simulated) match start into a local Twitch prediction.
/// Returns `true` when a new prediction was actually opened.
async fn trigger_local_prediction(
    db: &Arc<Db>,
    predictions: &Arc<RwLock<Option<PredictionRuntime>>>,
    shared: &Shared,
    game_mode: &ValorantGameMode,
) -> bool {
    let runtime = { predictions.read().unwrap().clone() };
    let Some(runtime) = runtime else {
        shared.push_log(
            "warn",
            "Match detected, but Twitch credentials are not set up yet.",
        );
        return false;
    };
    let user = match db.get_user() {
        Ok(Some(user)) => user,
        Ok(None) => {
            shared.push_log("warn", "Match detected, but no Twitch account is connected.");
            return false;
        }
        Err(error) => {
            shared.push_log("error", &format!("Database error: {error}"));
            return false;
        }
    };

    let mode = game_mode_label(game_mode);
    let outcome = runtime
        .service
        .handle_match_start(&user.twitch_user_id, "companion_detection", mode)
        .await;
    // Created, skipped or failed: the dashboard's events changed either way.
    shared.emit_dashboard_changed();
    match outcome {
        Ok(result) => {
            shared.update_status(|status| status.last_backend_response = result.message.clone());
            let created = result.action == "prediction_created";
            shared.push_log(if created { "success" } else { "info" }, &result.message);
            created
        }
        Err(error) => {
            let message = error.to_string();
            shared.update_status(|status| status.last_backend_response = message.clone());
            shared.push_log("error", &message);
            false
        }
    }
}

/// When a tracked match ends, read the result and resolve the open prediction to
/// the winning outcome (per the preset's `win_outcome`). On any uncertainty we
/// leave the prediction open for manual resolution rather than risk a wrong call.
async fn try_auto_resolve(
    db: &Arc<Db>,
    predictions: &Arc<RwLock<Option<PredictionRuntime>>>,
    shared: &Shared,
    active_match: &mut Option<ActiveMatch>,
    runtime: &mut DetectorRuntime,
) {
    // Copy what we need so we don't hold a borrow of `active_match` across await.
    let (match_id, game_mode) = match active_match.as_mut() {
        Some(am) => {
            am.ended_at.get_or_insert_with(Instant::now);
            (am.match_id.clone(), am.game_mode.clone())
        }
        None => return,
    };

    let Some(user) = db.get_user().ok().flatten() else {
        *active_match = None;
        return;
    };

    // If the prediction was already resolved/cancelled (e.g. manually), stop.
    let still_open = matches!(
        db.get_active_session(&user.twitch_user_id).ok().flatten().as_ref(),
        Some(session) if session.status == "prediction_open"
    );
    if !still_open {
        *active_match = None;
        return;
    }

    let Some(prediction_runtime) = predictions.read().unwrap().clone() else {
        *active_match = None;
        return;
    };

    match fetch_match_won(&match_id, runtime).await {
        Ok(Some(won)) => {
            let win_outcome = db
                .get_preset(&user.twitch_user_id, game_mode_label(&game_mode))
                .ok()
                .flatten()
                .map(|preset| preset.win_outcome)
                .unwrap_or_else(|| "A".to_string());
            // win_outcome marks the "win" side; flip it on a loss.
            let winner = match (win_outcome.as_str(), won) {
                ("B", true) => Winner::B,
                ("B", false) => Winner::A,
                (_, true) => Winner::A,
                (_, false) => Winner::B,
            };
            let resolved = prediction_runtime
                .service
                .resolve(&user.twitch_user_id, winner)
                .await;
            shared.emit_dashboard_changed();
            match resolved {
                Ok(_) => shared.push_log(
                    "success",
                    if won {
                        "Match ended in a win — prediction auto-resolved."
                    } else {
                        "Match ended in a loss — prediction auto-resolved."
                    },
                ),
                Err(error) => shared.push_log(
                    "error",
                    &format!(
                        "Auto-resolve failed: {error}. Resolve it manually from the dashboard."
                    ),
                ),
            }
            *active_match = None;
        }
        Ok(None) => give_up_if_past_deadline(
            active_match,
            shared,
            "Couldn't read the match result — gave up after 10 minutes. You can resolve manually.",
        ),
        Err(error) => give_up_if_past_deadline(
            active_match,
            shared,
            &format!("Couldn't read the match result ({error}). You can resolve manually."),
        ),
    }
}

/// Stop retrying the result lookup `RESOLVE_DEADLINE` after the match ended and
/// leave the prediction for manual resolution.
fn give_up_if_past_deadline(
    active_match: &mut Option<ActiveMatch>,
    shared: &Shared,
    give_up_message: &str,
) {
    let expired = active_match
        .as_ref()
        .and_then(|am| am.ended_at)
        .is_some_and(|ended_at| resolve_deadline_passed(ended_at, Instant::now()));
    if expired {
        shared.push_log("warn", give_up_message);
        *active_match = None;
    }
}

#[tauri::command]
pub async fn simulate_pregame(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    state.shared.update_status(|status| {
        status.local_state = ValorantLocalState::PreGame;
        status.game_mode = ValorantGameMode::Unknown;
        status.confidence = 0.85;
    });
    state.shared.push_log(
        "info",
        "Simulated pre-game state (predictions only start once a match is live).",
    );
    Ok(BackendResponse {
        ok: true,
        action: "ignored".into(),
        message: "Pre-game simulated. Predictions start when a match goes live.".into(),
    })
}

#[tauri::command]
pub async fn simulate_competitive_current_game(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    run_local_simulation(&state, ValorantGameMode::Competitive).await
}

#[tauri::command]
pub async fn simulate_custom_current_game(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    run_local_simulation(&state, ValorantGameMode::Custom).await
}

async fn run_local_simulation(
    state: &State<'_, AppRuntimeState>,
    game_mode: ValorantGameMode,
) -> Result<BackendResponse, String> {
    let user = state
        .db
        .get_user()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Connect your Twitch account first.".to_string())?;
    let runtime = crate::predictions::current_runtime(state)?;
    let mode = game_mode_label(&game_mode);
    state
        .shared
        .push_log("info", &format!("Simulating a {mode} match start…"));

    let outcome = runtime
        .service
        .handle_match_start(&user.twitch_user_id, "manual", mode)
        .await;
    state.shared.emit_dashboard_changed();
    match outcome {
        Ok(result) => {
            state.shared.update_status(|status| {
                status.local_state = ValorantLocalState::CurrentGame;
                status.game_mode = game_mode;
                status.confidence = 0.95;
                status.last_backend_response = result.message.clone();
            });
            state.shared.start_cooldown(CURRENT_GAME_COOLDOWN_SECONDS);
            let level = if result.action == "prediction_created" {
                "success"
            } else {
                "info"
            };
            state.shared.push_log(level, &result.message);
            Ok(BackendResponse {
                ok: true,
                action: result.action.into(),
                message: result.message,
            })
        }
        Err(error) => {
            let message = error.to_string();
            state
                .shared
                .update_status(|status| status.last_backend_response = message.clone());
            state.shared.push_log("error", &message);
            Err(message)
        }
    }
}

#[tauri::command]
pub fn reset_cooldown(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    state.shared.reset_cooldown();
    state.shared.push_log("info", "Current-game cooldown reset.");
    state.shared.status()
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    state.shared.clear_logs();
    state.shared.status()
}

pub use crate::shared::sanitize_log;

pub fn game_mode_label(game_mode: &ValorantGameMode) -> &'static str {
    match game_mode {
        ValorantGameMode::Competitive => "competitive",
        ValorantGameMode::Custom => "custom",
        ValorantGameMode::Unknown => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_deadline_is_ten_minutes_after_the_match_ended() {
        let ended = Instant::now();
        assert!(!resolve_deadline_passed(ended, ended));
        assert!(!resolve_deadline_passed(
            ended,
            ended + Duration::from_secs(10 * 60 - 1)
        ));
        assert!(resolve_deadline_passed(
            ended,
            ended + Duration::from_secs(10 * 60)
        ));
    }

    #[test]
    fn a_restart_retires_the_older_loop() {
        let monitoring = AtomicBool::new(true);
        let generation = AtomicU64::new(1);
        assert!(is_current_loop(&monitoring, &generation, 1));
        // Stop then start again while the old loop was mid-poll.
        monitoring.store(false, Ordering::SeqCst);
        monitoring.store(true, Ordering::SeqCst);
        generation.store(2, Ordering::SeqCst);
        assert!(!is_current_loop(&monitoring, &generation, 1));
        assert!(is_current_loop(&monitoring, &generation, 2));
        monitoring.store(false, Ordering::SeqCst);
        assert!(!is_current_loop(&monitoring, &generation, 2));
    }

    #[test]
    fn startup_creates_presets_for_an_existing_account() {
        use vap_core::db::UpsertUser;
        let db = Db::open_in_memory().unwrap();
        // Nobody connected: nothing to create, and no error.
        ensure_presets_for_existing_user(&db);
        let user = db
            .upsert_user(UpsertUser {
                twitch_user_id: "1".into(),
                twitch_login: "ace".into(),
                twitch_display_name: "Ace".into(),
                twitch_profile_image_url: None,
                access_token: "a".into(),
                refresh_token: "r".into(),
                token_expires_at: "2030-01-01T00:00:00.000Z".into(),
            })
            .unwrap();
        assert!(db.get_presets(&user.twitch_user_id).unwrap().is_empty());
        ensure_presets_for_existing_user(&db);
        assert_eq!(db.get_presets(&user.twitch_user_id).unwrap().len(), 2);
    }
}
