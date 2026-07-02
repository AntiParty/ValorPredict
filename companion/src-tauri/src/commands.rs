use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    time::Instant,
};

use chrono::Utc;
use parking_lot::Mutex;
use tauri::State;

use vap_core::db::Db;
use vap_core::predictions::Winner;

use crate::{
    models::{
        clamp_poll_interval, AppSettings, BackendResponse, LogEntry, SettingsView,
        ValorantDetectionStatus, ValorantGameMode, ValorantLocalState,
    },
    predictions::{restore_runtime, PredictionRuntime},
    settings::SettingsStore,
    valorant_detector::{detect_once, fetch_match_won, DetectionDecision, DetectorMemory},
};

/// A match we opened a prediction for and are waiting to auto-resolve once it
/// ends. `attempts` bounds how long we keep retrying the result lookup.
struct ActiveMatch {
    match_id: String,
    game_mode: ValorantGameMode,
    attempts: u32,
}

/// ~30 polls of grace for Riot to publish the finished-match result before we
/// give up and ask the streamer to resolve manually.
const MAX_RESOLVE_ATTEMPTS: u32 = 30;

pub struct AppRuntimeState {
    pub settings: Arc<Mutex<AppSettings>>,
    pub status: Arc<Mutex<ValorantDetectionStatus>>,
    pub settings_store: SettingsStore,
    pub monitoring: Arc<AtomicBool>,
    /// Local SQLite-backed prediction store (replaces the remote backend).
    pub db: Arc<Db>,
    /// Twitch client + prediction service, present once credentials are saved.
    pub predictions: Arc<RwLock<Option<PredictionRuntime>>>,
}

impl AppRuntimeState {
    pub fn new(settings_store: SettingsStore, db: Arc<Db>) -> Self {
        let settings = settings_store.load().unwrap_or_default();
        let predictions = restore_runtime(&db);
        Self {
            settings: Arc::new(Mutex::new(settings)),
            status: Arc::new(Mutex::new(ValorantDetectionStatus::default())),
            settings_store,
            monitoring: Arc::new(AtomicBool::new(false)),
            db,
            predictions: Arc::new(RwLock::new(predictions)),
        }
    }
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppRuntimeState>) -> SettingsView {
    SettingsView::from(&*state.settings.lock())
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppRuntimeState>,
    poll_interval_seconds: u64,
) -> Result<SettingsView, String> {
    let mut current = state.settings.lock();
    current.poll_interval_seconds = clamp_poll_interval(poll_interval_seconds);
    state.settings_store.save(&current)?;
    push_log(&state.status, "info", "Settings saved.");
    Ok(SettingsView::from(&*current))
}

#[tauri::command]
pub fn get_status(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    let mut status = state.status.lock();
    if status.cooldown_remaining_seconds > 0 {
        status.cooldown_remaining_seconds = status.cooldown_remaining_seconds.saturating_sub(1);
    }
    status.clone()
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
        return state.status.lock().clone();
    }
    state.status.lock().monitoring = true;
    push_log(
        &state.status,
        "info",
        "Read-only Riot monitoring started. Predictions run locally on this PC.",
    );
    let settings = state.settings.clone();
    let status = state.status.clone();
    let db = state.db.clone();
    let predictions = state.predictions.clone();
    let monitoring = state.monitoring.clone();
    tauri::async_runtime::spawn(async move {
        let mut memory = DetectorMemory::default();
        let mut active_match: Option<ActiveMatch> = None;
        while monitoring.load(Ordering::SeqCst) {
            let poll_interval = clamp_poll_interval(settings.lock().poll_interval_seconds);
            match detect_once().await {
                Ok(snapshot) => {
                    {
                        let mut current = status.lock();
                        current.riot_lockfile_found = snapshot.lockfile_found;
                        current.riot_client_running = snapshot.processes.riot_client_running;
                        current.valorant_running = snapshot.processes.valorant_running;
                        current.region = snapshot.region.clone();
                        current.shard = snapshot.shard.clone();
                        current.local_state = snapshot.state.clone();
                        current.game_mode = snapshot.game_mode.clone();
                        current.confidence = snapshot.confidence;
                        current.last_match_id_hash = snapshot.match_id_hash.clone();
                    }

                    // A match we opened a prediction for has ended -> resolve it
                    // from the result. Uses the raw poll state, not the deduped
                    // decision, so we react as soon as the game is no longer live.
                    if active_match.is_some()
                        && snapshot.state != ValorantLocalState::CurrentGame
                    {
                        try_auto_resolve(&db, &predictions, &status, &mut active_match).await;
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
                                &status,
                                &decided.game_mode,
                            )
                            .await;
                            status.lock().cooldown_remaining_seconds = 600;
                            if created {
                                if let Some(match_id) = decided.match_id_raw.clone() {
                                    active_match = Some(ActiveMatch {
                                        match_id,
                                        game_mode: decided.game_mode.clone(),
                                        attempts: 0,
                                    });
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    push_log(&status, "error", &error);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(poll_interval)).await;
        }
        status.lock().monitoring = false;
        push_log(&status, "info", "Read-only Riot monitoring stopped.");
    });
    state.status.lock().clone()
}

#[tauri::command]
pub fn stop_monitoring(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    end_monitoring(&state)
}

pub fn end_monitoring(state: &AppRuntimeState) -> ValorantDetectionStatus {
    set_monitoring_preference(state, false);
    state.monitoring.store(false, Ordering::SeqCst);
    state.status.lock().monitoring = false;
    state.status.lock().clone()
}

fn set_monitoring_preference(state: &AppRuntimeState, enabled: bool) {
    let mut settings = state.settings.lock();
    settings.monitoring_enabled = enabled;
    if let Err(error) = state.settings_store.save(&settings) {
        push_log(
            &state.status,
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
    status: &Arc<Mutex<ValorantDetectionStatus>>,
    game_mode: &ValorantGameMode,
) -> bool {
    let runtime = { predictions.read().unwrap().clone() };
    let Some(runtime) = runtime else {
        push_log(
            status,
            "warn",
            "Match detected, but Twitch credentials are not set up yet.",
        );
        return false;
    };
    let user = match db.get_user() {
        Ok(Some(user)) => user,
        Ok(None) => {
            push_log(
                status,
                "warn",
                "Match detected, but no Twitch account is connected.",
            );
            return false;
        }
        Err(error) => {
            push_log(status, "error", &format!("Database error: {error}"));
            return false;
        }
    };

    let mode = game_mode_label(game_mode);
    match runtime
        .service
        .handle_match_start(&user.twitch_user_id, "companion_detection", mode)
        .await
    {
        Ok(result) => {
            status.lock().last_backend_response = result.message.clone();
            let created = result.action == "prediction_created";
            push_log(status, if created { "success" } else { "info" }, &result.message);
            created
        }
        Err(error) => {
            let message = error.to_string();
            status.lock().last_backend_response = message.clone();
            push_log(status, "error", &message);
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
    status: &Arc<Mutex<ValorantDetectionStatus>>,
    active_match: &mut Option<ActiveMatch>,
) {
    // Copy what we need so we don't hold a borrow of `active_match` across await.
    let (match_id, game_mode) = match active_match.as_ref() {
        Some(am) => (am.match_id.clone(), am.game_mode.clone()),
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

    let Some(runtime) = predictions.read().unwrap().clone() else {
        *active_match = None;
        return;
    };

    match fetch_match_won(&match_id).await {
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
            match runtime.service.resolve(&user.twitch_user_id, winner).await {
                Ok(_) => push_log(
                    status,
                    "success",
                    if won {
                        "Match ended in a win — prediction auto-resolved."
                    } else {
                        "Match ended in a loss — prediction auto-resolved."
                    },
                ),
                Err(error) => push_log(
                    status,
                    "error",
                    &format!(
                        "Auto-resolve failed: {error}. Resolve it manually from the dashboard."
                    ),
                ),
            }
            *active_match = None;
        }
        Ok(None) => bump_resolve_attempt(
            active_match,
            status,
            "Couldn't read the match result yet — will keep trying. You can also resolve manually.",
        ),
        Err(error) => bump_resolve_attempt(
            active_match,
            status,
            &format!("Couldn't read the match result ({error}). You can resolve manually."),
        ),
    }
}

/// Count a failed result lookup; after `MAX_RESOLVE_ATTEMPTS`, give up and leave
/// the prediction for manual resolution.
fn bump_resolve_attempt(
    active_match: &mut Option<ActiveMatch>,
    status: &Arc<Mutex<ValorantDetectionStatus>>,
    give_up_message: &str,
) {
    let exhausted = match active_match.as_mut() {
        Some(am) => {
            am.attempts += 1;
            am.attempts >= MAX_RESOLVE_ATTEMPTS
        }
        None => false,
    };
    if exhausted {
        push_log(status, "warn", give_up_message);
        *active_match = None;
    }
}

#[tauri::command]
pub async fn simulate_pregame(state: State<'_, AppRuntimeState>) -> Result<BackendResponse, String> {
    {
        let mut status = state.status.lock();
        status.local_state = ValorantLocalState::PreGame;
        status.game_mode = ValorantGameMode::Unknown;
        status.confidence = 0.85;
    }
    push_log(
        &state.status,
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
    push_log(&state.status, "info", &format!("Simulating a {mode} match start…"));

    match runtime
        .service
        .handle_match_start(&user.twitch_user_id, "manual", mode)
        .await
    {
        Ok(result) => {
            {
                let mut status = state.status.lock();
                status.local_state = ValorantLocalState::CurrentGame;
                status.game_mode = game_mode;
                status.confidence = 0.95;
                status.last_backend_response = result.message.clone();
                status.cooldown_remaining_seconds = 600;
            }
            let level = if result.action == "prediction_created" {
                "success"
            } else {
                "info"
            };
            push_log(&state.status, level, &result.message);
            Ok(BackendResponse {
                ok: true,
                action: result.action.into(),
                message: result.message,
            })
        }
        Err(error) => {
            let message = error.to_string();
            state.status.lock().last_backend_response = message.clone();
            push_log(&state.status, "error", &message);
            Err(message)
        }
    }
}

#[tauri::command]
pub fn reset_cooldown(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    state.status.lock().cooldown_remaining_seconds = 0;
    push_log(&state.status, "info", "Current-game cooldown reset.");
    state.status.lock().clone()
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppRuntimeState>) -> ValorantDetectionStatus {
    state.status.lock().logs.clear();
    state.status.lock().clone()
}

pub fn push_log(status: &Arc<Mutex<ValorantDetectionStatus>>, level: &str, message: &str) {
    let mut status = status.lock();
    status.logs.push(LogEntry {
        timestamp: Utc::now().to_rfc3339(),
        level: level.into(),
        message: sanitize_log(message),
    });
    if status.logs.len() > 200 {
        let excess = status.logs.len() - 200;
        status.logs.drain(0..excess);
    }
}

fn sanitize_log(message: &str) -> String {
    let mut sanitized = message.to_string();
    for marker in ["vap_", "Bearer ", "Basic "] {
        if let Some(index) = sanitized.find(marker) {
            sanitized.truncate(index);
            sanitized.push_str("[secret redacted]");
        }
    }
    sanitized
}

fn game_mode_label(game_mode: &ValorantGameMode) -> &'static str {
    match game_mode {
        ValorantGameMode::Competitive => "competitive",
        ValorantGameMode::Custom => "custom",
        ValorantGameMode::Unknown => "unknown",
    }
}
