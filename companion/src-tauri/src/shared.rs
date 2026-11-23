//! State shared between the monitoring loop, the commands and the tray:
//! the detection status, the log buffer, counters, and the channel for pushing
//! change notifications to the UI.
//!
//! `get_status` and `get_logs` only read. The cooldown is stored as a deadline,
//! so reading it never changes it.

use std::{
    collections::VecDeque,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use chrono::Utc;
use parking_lot::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    metrics::DetectionMetrics,
    models::{LogEntry, ValorantDetectionStatus, ValorantGameMode, ValorantLocalState},
};

pub const STATUS_CHANGED: &str = "status-changed";
pub const DASHBOARD_CHANGED: &str = "dashboard-changed";
pub const LOGS_CHANGED: &str = "logs-changed";

const MAX_LOGS: usize = 200;

/// The fields the UI shows. `status-changed` is only emitted when this changes
/// (the cooldown is reduced to "is one running", since it counts down on its own).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UiStatusKey {
    riot_lockfile_found: bool,
    riot_client_running: bool,
    valorant_running: bool,
    region: String,
    shard: String,
    local_state: ValorantLocalState,
    game_mode: ValorantGameMode,
    cooldown_active: bool,
    last_backend_response: String,
    monitoring: bool,
}

pub fn ui_status_key(status: &ValorantDetectionStatus) -> UiStatusKey {
    UiStatusKey {
        riot_lockfile_found: status.riot_lockfile_found,
        riot_client_running: status.riot_client_running,
        valorant_running: status.valorant_running,
        region: status.region.clone(),
        shard: status.shard.clone(),
        local_state: status.local_state.clone(),
        game_mode: status.game_mode.clone(),
        cooldown_active: status.cooldown_remaining_seconds > 0,
        last_backend_response: status.last_backend_response.clone(),
        monitoring: status.monitoring,
    }
}

struct StatusInner {
    status: ValorantDetectionStatus,
    cooldown_until: Option<Instant>,
}

impl StatusInner {
    /// The status with the cooldown worked out from the deadline. Read-only.
    fn view_at(&self, now: Instant) -> ValorantDetectionStatus {
        let mut status = self.status.clone();
        status.cooldown_remaining_seconds = self
            .cooldown_until
            .map(|until| remaining_seconds(until, now))
            .unwrap_or(0);
        status
    }
}

/// Whole seconds left until `until`, rounded up so the last second shows 1.
pub fn remaining_seconds(until: Instant, now: Instant) -> u64 {
    let left = until.saturating_duration_since(now);
    left.as_secs() + u64::from(left.subsec_nanos() > 0)
}

pub struct Shared {
    status: Mutex<StatusInner>,
    logs: Mutex<VecDeque<LogEntry>>,
    app: OnceLock<AppHandle>,
    pub metrics: Arc<DetectionMetrics>,
}

impl Default for Shared {
    fn default() -> Self {
        Self::new()
    }
}

impl Shared {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(StatusInner {
                status: ValorantDetectionStatus::default(),
                cooldown_until: None,
            }),
            logs: Mutex::new(VecDeque::new()),
            app: OnceLock::new(),
            metrics: Arc::new(DetectionMetrics::new()),
        }
    }

    /// Give the shared state a way to notify the UI. Called once from `setup`.
    pub fn set_app_handle(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    fn emit(&self, event: &str, payload: Value) {
        if let Some(app) = self.app.get() {
            let _ = app.emit(event, payload);
        }
    }

    // ---- status ------------------------------------------------------------

    pub fn status(&self) -> ValorantDetectionStatus {
        self.status_at(Instant::now())
    }

    pub fn status_at(&self, now: Instant) -> ValorantDetectionStatus {
        self.status.lock().view_at(now)
    }

    /// Change the status, then emit `status-changed` if a UI-visible field changed.
    pub fn update_status<R>(&self, change: impl FnOnce(&mut ValorantDetectionStatus) -> R) -> R {
        self.mutate(Instant::now(), |inner| change(&mut inner.status))
    }

    pub fn start_cooldown(&self, seconds: u64) {
        let now = Instant::now();
        self.mutate(now, |inner| {
            inner.cooldown_until = Some(now + Duration::from_secs(seconds));
        });
    }

    pub fn reset_cooldown(&self) {
        self.mutate(Instant::now(), |inner| inner.cooldown_until = None);
    }

    fn mutate<R>(&self, now: Instant, change: impl FnOnce(&mut StatusInner) -> R) -> R {
        let (result, emit) = {
            let mut inner = self.status.lock();
            let before = ui_status_key(&inner.view_at(now));
            let result = change(&mut inner);
            let after = inner.view_at(now);
            let changed = ui_status_key(&after) != before;
            (result, changed.then_some(after))
        };
        if let Some(status) = emit {
            if let Ok(payload) = serde_json::to_value(&status) {
                self.emit(STATUS_CHANGED, payload);
            }
        }
        result
    }

    // ---- dashboard ---------------------------------------------------------

    pub fn emit_dashboard_changed(&self) {
        self.emit(DASHBOARD_CHANGED, Value::Null);
    }

    // ---- logs --------------------------------------------------------------

    pub fn logs(&self) -> Vec<LogEntry> {
        self.logs.lock().iter().cloned().collect()
    }

    pub fn push_log(&self, level: &str, message: &str) {
        {
            let mut logs = self.logs.lock();
            logs.push_back(LogEntry {
                timestamp: Utc::now().to_rfc3339(),
                level: level.into(),
                message: sanitize_log(message),
            });
            while logs.len() > MAX_LOGS {
                logs.pop_front();
            }
        }
        self.emit(LOGS_CHANGED, Value::Null);
    }

    pub fn clear_logs(&self) {
        self.logs.lock().clear();
        self.emit(LOGS_CHANGED, Value::Null);
    }
}

pub fn sanitize_log(message: &str) -> String {
    let mut sanitized = message.to_string();
    for marker in ["vap_", "vp1_", "Bearer ", "Basic "] {
        if let Some(index) = sanitized.find(marker) {
            sanitized.truncate(index);
            sanitized.push_str("[secret redacted]");
        }
    }
    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_the_status_never_changes_the_cooldown() {
        let shared = Shared::new();
        shared.start_cooldown(600);
        let now = Instant::now();
        let first = shared.status_at(now);
        for _ in 0..50 {
            assert_eq!(
                shared.status_at(now).cooldown_remaining_seconds,
                first.cooldown_remaining_seconds
            );
        }
        assert!((599..=600).contains(&first.cooldown_remaining_seconds));
        // Only the clock moves it.
        let later = shared.status_at(now + Duration::from_secs(100));
        assert!((499..=500).contains(&later.cooldown_remaining_seconds));
        assert_eq!(
            shared.status_at(now + Duration::from_secs(700)).cooldown_remaining_seconds,
            0
        );
    }

    #[test]
    fn reset_cooldown_clears_it() {
        let shared = Shared::new();
        shared.start_cooldown(600);
        shared.reset_cooldown();
        assert_eq!(shared.status().cooldown_remaining_seconds, 0);
    }

    #[test]
    fn remaining_seconds_rounds_up() {
        let now = Instant::now();
        assert_eq!(remaining_seconds(now + Duration::from_millis(1500), now), 2);
        assert_eq!(remaining_seconds(now + Duration::from_secs(3), now), 3);
        assert_eq!(remaining_seconds(now, now + Duration::from_secs(1)), 0);
    }

    #[test]
    fn countdown_ticks_do_not_count_as_ui_changes() {
        let mut a = ValorantDetectionStatus {
            cooldown_remaining_seconds: 600,
            ..Default::default()
        };
        let mut b = a.clone();
        b.cooldown_remaining_seconds = 599;
        b.confidence = 0.5;
        assert_eq!(ui_status_key(&a), ui_status_key(&b));
        b.cooldown_remaining_seconds = 0;
        assert_ne!(ui_status_key(&a), ui_status_key(&b));
        a.cooldown_remaining_seconds = 0;
        b.local_state = ValorantLocalState::Menus;
        assert_ne!(ui_status_key(&a), ui_status_key(&b));
    }

    #[test]
    fn update_status_reports_through_the_buffered_state() {
        let shared = Shared::new();
        shared.update_status(|s| s.monitoring = true);
        assert!(shared.status().monitoring);
    }

    #[test]
    fn logs_are_capped_oldest_first_and_redacted() {
        let shared = Shared::new();
        for i in 0..210 {
            shared.push_log("info", &format!("line {i}"));
        }
        let logs = shared.logs();
        assert_eq!(logs.len(), 200);
        assert_eq!(logs[0].message, "line 10");
        assert_eq!(logs[199].message, "line 209");
        shared.push_log("error", "failed with Bearer abc123");
        assert_eq!(
            shared.logs().last().unwrap().message,
            "failed with [secret redacted]"
        );
        shared.clear_logs();
        assert!(shared.logs().is_empty());
    }
}
