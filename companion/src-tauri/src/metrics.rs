//! Cheap rolling counters for the dev-only Diagnostics panel: how much work the
//! detection loop did in the last minute and how long the last poll took.

use std::{
    collections::VecDeque,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use serde::Serialize;

const WINDOW: Duration = Duration::from_secs(60);
const NO_POLL_YET: u64 = u64::MAX;

/// Counts events in a sliding one-minute window. Events are rare (a handful
/// per minute), so a pruned queue of timestamps is both exact and cheap.
#[derive(Default)]
pub struct RollingCounter {
    events: Mutex<VecDeque<Instant>>,
}

impl RollingCounter {
    pub fn record(&self) {
        self.record_at(Instant::now());
    }

    pub fn record_at(&self, now: Instant) {
        let mut events = self.events.lock();
        prune(&mut events, now);
        events.push_back(now);
    }

    pub fn count(&self) -> u64 {
        self.count_at(Instant::now())
    }

    pub fn count_at(&self, now: Instant) -> u64 {
        let mut events = self.events.lock();
        prune(&mut events, now);
        events.len() as u64
    }
}

fn prune(events: &mut VecDeque<Instant>, now: Instant) {
    while events
        .front()
        .is_some_and(|at| now.saturating_duration_since(*at) >= WINDOW)
    {
        events.pop_front();
    }
}

#[derive(Default)]
pub struct DetectionMetrics {
    pub loopback_calls: RollingCounter,
    pub riot_server_calls: RollingCounter,
    pub log_reads: RollingCounter,
    pub process_scans: RollingCounter,
    last_poll_ms: AtomicU64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionMetricsView {
    pub last_poll_ms: Option<u64>,
    pub loopback_calls_last_minute: u64,
    pub riot_server_calls_last_minute: u64,
    pub log_reads_last_minute: u64,
    pub process_scans_last_minute: u64,
}

impl DetectionMetrics {
    pub fn new() -> Self {
        Self {
            last_poll_ms: AtomicU64::new(NO_POLL_YET),
            ..Self::default()
        }
    }

    pub fn record_poll(&self, took: Duration) {
        let ms = u64::try_from(took.as_millis()).unwrap_or(u64::MAX - 1);
        self.last_poll_ms.store(ms.min(NO_POLL_YET - 1), Ordering::Relaxed);
    }

    pub fn view(&self) -> DetectionMetricsView {
        self.view_at(Instant::now())
    }

    pub fn view_at(&self, now: Instant) -> DetectionMetricsView {
        let last = self.last_poll_ms.load(Ordering::Relaxed);
        DetectionMetricsView {
            last_poll_ms: (last != NO_POLL_YET).then_some(last),
            loopback_calls_last_minute: self.loopback_calls.count_at(now),
            riot_server_calls_last_minute: self.riot_server_calls.count_at(now),
            log_reads_last_minute: self.log_reads.count_at(now),
            process_scans_last_minute: self.process_scans.count_at(now),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_only_counts_the_last_minute() {
        let counter = RollingCounter::default();
        let t0 = Instant::now();
        counter.record_at(t0);
        counter.record_at(t0 + Duration::from_secs(30));
        assert_eq!(counter.count_at(t0 + Duration::from_secs(59)), 2);
        assert_eq!(counter.count_at(t0 + Duration::from_secs(60)), 1);
        assert_eq!(counter.count_at(t0 + Duration::from_secs(91)), 0);
    }

    #[test]
    fn view_reports_no_poll_until_one_is_recorded() {
        let metrics = DetectionMetrics::new();
        assert_eq!(metrics.view().last_poll_ms, None);
        metrics.loopback_calls.record();
        metrics.record_poll(Duration::from_millis(42));
        let view = metrics.view();
        assert_eq!(view.last_poll_ms, Some(42));
        assert_eq!(view.loopback_calls_last_minute, 1);
        assert_eq!(view.riot_server_calls_last_minute, 0);
        let json = serde_json::to_value(&view).unwrap();
        assert!(json.get("lastPollMs").is_some());
        assert!(json.get("processScansLastMinute").is_some());
    }
}
