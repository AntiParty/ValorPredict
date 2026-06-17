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
    pub backend_url: String,
    pub local_api_key: String,
    pub poll_interval_seconds: u64,
    #[serde(default)]
    pub monitoring_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub backend_url: String,
    pub local_api_key_masked: String,
    pub has_local_api_key: bool,
    pub poll_interval_seconds: u64,
    pub monitoring_enabled: bool,
}

impl From<&AppSettings> for SettingsView {
    fn from(settings: &AppSettings) -> Self {
        Self {
            backend_url: settings.backend_url.clone(),
            local_api_key_masked: settings.masked_api_key(),
            has_local_api_key: !settings.local_api_key.is_empty(),
            poll_interval_seconds: settings.poll_interval_seconds,
            monitoring_enabled: settings.monitoring_enabled,
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            backend_url: "http://localhost:3000".into(),
            local_api_key: String::new(),
            poll_interval_seconds: DEFAULT_POLL_INTERVAL_SECONDS,
            monitoring_enabled: false,
        }
    }
}

impl AppSettings {
    pub fn masked_api_key(&self) -> String {
        if self.local_api_key.is_empty() {
            return String::new();
        }
        let prefix = if self.local_api_key.starts_with("vap_") {
            "vap_"
        } else {
            ""
        };
        format!(
            "{prefix}{}",
            "•".repeat(self.local_api_key.len() - prefix.len())
        )
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
pub struct BackendEventDetails {
    pub detection_method: String,
    pub region: String,
    pub shard: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackendEventPayload {
    pub source: String,
    pub state: ValorantLocalState,
    pub game_mode: ValorantGameMode,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_id_hash: Option<String>,
    pub details: BackendEventDetails,
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
    pub backend_connected: bool,
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
    pub duo_enabled: bool,
    pub duo_status: String,
    pub logs: Vec<LogEntry>,
}

impl Default for ValorantDetectionStatus {
    fn default() -> Self {
        Self {
            backend_connected: false,
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
            last_backend_response: "No backend request yet.".into(),
            monitoring: false,
            duo_enabled: false,
            duo_status: "Duo command inactive.".into(),
            logs: Vec::new(),
        }
    }
}
