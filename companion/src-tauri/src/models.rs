use serde::{Deserialize, Serialize};

pub const DEFAULT_POLL_INTERVAL_SECONDS: u64 = 15;
pub const MIN_POLL_INTERVAL_SECONDS: u64 = 10;
pub const MAX_POLL_INTERVAL_SECONDS: u64 = 60;

pub fn clamp_poll_interval(seconds: u64) -> u64 {
    seconds.clamp(MIN_POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub poll_interval_seconds: u64,
    #[serde(default)]
    pub monitoring_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub poll_interval_seconds: u64,
    pub monitoring_enabled: bool,
}

impl From<&AppSettings> for SettingsView {
    fn from(settings: &AppSettings) -> Self {
        Self {
            poll_interval_seconds: settings.poll_interval_seconds,
            monitoring_enabled: settings.monitoring_enabled,
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            poll_interval_seconds: DEFAULT_POLL_INTERVAL_SECONDS,
            monitoring_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValorantLocalState {
    Unknown,
    NotRunning,
    Menus,
    PreGame,
    CurrentGame,
    PostGame,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValorantGameMode {
    Competitive,
    Custom,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackendResponse {
    pub ok: bool,
    pub action: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValorantDetectionStatus {
    pub riot_lockfile_found: bool,
    pub riot_client_running: bool,
    pub valorant_running: bool,
    pub region: String,
    pub shard: String,
    pub local_state: ValorantLocalState,
    pub game_mode: ValorantGameMode,
    pub confidence: f64,
    pub last_match_id_hash: Option<String>,
    pub cooldown_remaining_seconds: u64,
    pub last_backend_response: String,
    pub monitoring: bool,
    pub logs: Vec<LogEntry>,
}

impl Default for ValorantDetectionStatus {
    fn default() -> Self {
        Self {
            riot_lockfile_found: false,
            riot_client_running: false,
            valorant_running: false,
            region: "unknown".into(),
            shard: "unknown".into(),
            local_state: ValorantLocalState::Unknown,
            game_mode: ValorantGameMode::Unknown,
            confidence: 0.0,
            last_match_id_hash: None,
            cooldown_remaining_seconds: 0,
            last_backend_response: "No prediction activity yet.".into(),
            monitoring: false,
            logs: Vec::new(),
        }
    }
}
