use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

use chrono::Utc;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{
    backend_client::BackendClient,
    models::{
        clamp_poll_interval, AppSettings, BackendEventDetails, BackendEventPayload,
        BackendResponse, LogEntry, SettingsView, ValorantDetectionStatus, ValorantGameMode,
        ValorantLocalState,
    },
    riot_local_client::DuoParty,
    settings::SettingsStore,
    valorant_detector::{detect_current_party, detect_once, DetectionDecision, DetectorMemory},
};

pub struct AppRuntimeState {
    pub settings: Arc<Mutex<AppSettings>>,
    pub status: Arc<Mutex<ValorantDetectionStatus>>,
    pub settings_store: SettingsStore,
    pub backend: BackendClient,
    pub monitoring: Arc<AtomicBool>,
}

impl AppRuntimeState {
    pub fn new(settings_store: SettingsStore) -> Self {
        let settings = settings_store.load().unwrap_or_default();
        Self {
            settings: Arc::new(Mutex::new(settings)),
            status: Arc::new(Mutex::new(ValorantDetectionStatus::default())),
            settings_store,
            backend: BackendClient::default(),
            monitoring: Arc::new(AtomicBool::new(false)),
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
    backend_url: String,
    local_api_key: String,
    poll_interval_seconds: u64,
) -> Result<SettingsView, String> {
    let mut current = state.settings.lock();
    current.backend_url = backend_url.trim().trim_end_matches('/').to_string();
    if !local_api_key.trim().is_empty() {
        current.local_api_key = local_api_key.trim().to_string();
    }
    current.poll_interval_seconds = clamp_poll_interval(poll_interval_seconds);
    state.settings_store.save(&current)?;
    push_log(
        &state.status,
        "info",
        "Settings saved. The local API key remains masked.",
    );
    Ok(SettingsView::from(&*current))
}

#[tauri::command]
pub async fn test_backend_connection(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    let settings = state.settings.lock().clone();
    match state.backend.ping(&settings).await {
        Ok(outcome) => {
            let mut status = state.status.lock();
            status.backend_connected = outcome.ok;
            status.duo_enabled = outcome.duo_enabled;
            status.last_backend_response = outcome.message.clone();
            drop(status);
            push_log(&state.status, "success", &outcome.message);
            Ok(BackendResponse {
                ok: outcome.ok,
                action: "connected".into(),
                message: outcome.message,
            })
        }
        Err(error) => {
            state.status.lock().backend_connected = false;
            push_log(&state.status, "error", &error);
            Err(error)
        }
    }
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
    settings.monitoring_enabled && !settings.local_api_key.trim().is_empty()
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
        "Read-only Riot monitoring started. Simulation controls remain available.",
    );
    let settings = state.settings.clone();
    let status = state.status.clone();
    let backend = state.backend.clone();
    let monitoring = state.monitoring.clone();
    tauri::async_runtime::spawn(async move {
        let mut memory = DetectorMemory::default();
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
                    if let DetectionDecision::Send(snapshot) =
                        memory.evaluate(&snapshot, Instant::now())
                    {
                        let current_settings = settings.lock().clone();
                        if current_settings.local_api_key.is_empty() {
                            push_log(
                                &status,
                                "warn",
                                "State changed, but no local API key is configured.",
                            );
                        } else {
                            match backend
                                .send_state(&current_settings, &snapshot.to_payload())
                                .await
                            {
                                Ok(response) => {
                                    let mut current = status.lock();
                                    current.backend_connected = true;
                                    current.last_backend_response = response.message.clone();
                                    if snapshot.state == ValorantLocalState::CurrentGame {
                                        current.cooldown_remaining_seconds = 600;
                                    }
                                    drop(current);
                                    push_log(
                                        &status,
                                        "success",
                                        &format!(
                                            "State {} sent: {}",
                                            state_label(&snapshot.state),
                                            response.message
                                        ),
                                    );
                                }
                                Err(error) => {
                                    status.lock().last_backend_response = error.clone();
                                    push_log(&status, "error", &error);
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    push_log(&status, "error", &error);
                }
            }
            refresh_duo_publication(&settings, &status, &backend).await;
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

async fn refresh_duo_publication(
    settings: &Arc<Mutex<AppSettings>>,
    status: &Arc<Mutex<ValorantDetectionStatus>>,
    backend: &BackendClient,
) {
    let current_settings = settings.lock().clone();
    if current_settings.local_api_key.is_empty() {
        return;
    }

    let outcome = match backend.ping(&current_settings).await {
        Ok(outcome) => outcome,
        Err(error) => {
            status.lock().backend_connected = false;
            push_log(status, "error", &error);
            return;
        }
    };
    {
        let mut current = status.lock();
        current.backend_connected = outcome.ok;
        current.duo_enabled = outcome.duo_enabled;
        if !outcome.duo_enabled {
            current.duo_status = "Duo command is off.".into();
        }
    }
    if !outcome.duo_enabled {
        return;
    }

    match detect_current_party().await {
        Ok(party) => {
            let summary = duo_status_summary(&party);
            match backend.upload_duo(&current_settings, &party).await {
                Ok(response) => {
                    let mut current = status.lock();
                    current.backend_connected = true;
                    current.duo_status = summary;
                    current.last_backend_response = response.message.clone();
                    drop(current);
                    push_log(status, "info", &format!("Duo command: {}", response.message));
                }
                Err(error) => {
                    status.lock().duo_status = "Duo upload failed.".into();
                    push_log(status, "error", &error);
                }
            }
        }
        Err(error) => {
            status.lock().duo_status = "Could not read your Valorant party.".into();
            push_log(status, "warn", &error);
        }
    }
}

fn duo_status_summary(party: &DuoParty) -> String {
    if !party.in_party || party.members.is_empty() {
        return "On · not queued with anyone right now.".into();
    }
    let names = party
        .members
        .iter()
        .map(|member| member.name.clone())
        .collect::<Vec<_>>()
        .join(", ");
    format!("On · queued with {names}")
}

#[tauri::command]
pub async fn simulate_pregame(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    send_simulation(
        &state,
        ValorantLocalState::PreGame,
        ValorantGameMode::Unknown,
        0.85,
    )
    .await
}

#[tauri::command]
pub async fn simulate_competitive_current_game(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    send_simulation(
        &state,
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Competitive,
        0.95,
    )
    .await
}

#[tauri::command]
pub async fn simulate_custom_current_game(
    state: State<'_, AppRuntimeState>,
) -> Result<BackendResponse, String> {
    send_simulation(
        &state,
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Custom,
        0.95,
    )
    .await
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

async fn send_simulation(
    state: &State<'_, AppRuntimeState>,
    local_state: ValorantLocalState,
    game_mode: ValorantGameMode,
    confidence: f64,
) -> Result<BackendResponse, String> {
    let settings = state.settings.lock().clone();
    let state_name = match local_state {
        ValorantLocalState::PreGame => "pre_game",
        ValorantLocalState::CurrentGame => "current_game",
        _ => "unknown",
    };
    let mode_name = game_mode_label(&game_mode);
    let hash = hex_sha256(&format!(
        "simulation:{state_name}:{mode_name}:{}",
        Utc::now().timestamp_millis()
    ));
    let payload = simulated_payload(
        local_state.clone(),
        game_mode.clone(),
        hash.clone(),
        confidence,
    );

    push_log(
        &state.status,
        "info",
        &format!(
            "Sending simulated {mode_name} {state_name} state ({}...).",
            &hash[..8]
        ),
    );
    match state.backend.send_state(&settings, &payload).await {
        Ok(response) => {
            let mut status = state.status.lock();
            status.backend_connected = true;
            status.local_state = local_state;
            status.game_mode = game_mode;
            status.confidence = confidence;
            status.last_match_id_hash = Some(hash);
            status.last_backend_response = response.message.clone();
            if status.local_state == ValorantLocalState::CurrentGame {
                status.cooldown_remaining_seconds = 600;
            }
            drop(status);
            push_log(&state.status, "success", &response.message);
            Ok(response)
        }
        Err(error) => {
            state.status.lock().last_backend_response = error.clone();
            push_log(&state.status, "error", &error);
            Err(error)
        }
    }
}

pub fn simulated_payload(
    local_state: ValorantLocalState,
    game_mode: ValorantGameMode,
    match_id_hash: String,
    confidence: f64,
) -> BackendEventPayload {
    let state_name = state_label(&local_state);
    let mode_name = game_mode_label(&game_mode);
    BackendEventPayload {
        source: "local_companion".into(),
        state: local_state,
        game_mode,
        confidence,
        match_id_hash: Some(match_id_hash),
        details: BackendEventDetails {
            detection_method: "simulation".into(),
            region: "unknown".into(),
            shard: "unknown".into(),
            evidence: vec![format!("simulated_{state_name}_{mode_name}")],
        },
    }
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

fn hex_sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn state_label(state: &ValorantLocalState) -> &'static str {
    match state {
        ValorantLocalState::Unknown => "unknown",
        ValorantLocalState::NotRunning => "not_running",
        ValorantLocalState::Menus => "menus",
        ValorantLocalState::PreGame => "pre_game",
        ValorantLocalState::CurrentGame => "current_game",
        ValorantLocalState::PostGame => "post_game",
    }
}

fn game_mode_label(game_mode: &ValorantGameMode) -> &'static str {
    match game_mode {
        ValorantGameMode::Competitive => "competitive",
        ValorantGameMode::Custom => "custom",
        ValorantGameMode::Unknown => "unknown",
    }
}
