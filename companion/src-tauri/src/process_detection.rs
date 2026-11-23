use std::sync::Arc;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::metrics::DetectionMetrics;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProcessSignals {
    pub riot_client_running: bool,
    pub valorant_running: bool,
}

pub fn record_process_name(signals: &mut ProcessSignals, name: &str) -> bool {
    if name.eq_ignore_ascii_case("riotclientservices.exe") {
        signals.riot_client_running = true;
    } else if name.eq_ignore_ascii_case("valorant-win64-shipping.exe") {
        signals.valorant_running = true;
    }
    signals.riot_client_running && signals.valorant_running
}

/// PIDs found by the last full scan.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct KnownPids {
    pub riot_client: Option<u32>,
    pub valorant: Option<u32>,
}

/// How the next detection should look at the process table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanPlan {
    /// Refresh just these PIDs (both processes were found last time).
    Known(Vec<u32>),
    /// Enumerate every process (something is missing, so it may have started).
    Full,
}

/// Refresh only known PIDs when both processes were found; otherwise do a full
/// scan, because a missing process might have been started since.
pub fn plan_scan(known: KnownPids) -> ScanPlan {
    match (known.riot_client, known.valorant) {
        (Some(riot), Some(valorant)) => ScanPlan::Known(vec![riot, valorant]),
        _ => ScanPlan::Full,
    }
}

/// Like `record_process_name`, but also remembers which PID matched.
pub fn record_process(
    signals: &mut ProcessSignals,
    pids: &mut KnownPids,
    name: &str,
    pid: u32,
) -> bool {
    let before = *signals;
    let done = record_process_name(signals, name);
    if signals.riot_client_running && !before.riot_client_running {
        pids.riot_client = Some(pid);
    }
    if signals.valorant_running && !before.valorant_running {
        pids.valorant = Some(pid);
    }
    done
}

pub struct ProcessDetector {
    system: System,
    known: KnownPids,
    metrics: Option<Arc<DetectionMetrics>>,
}

impl ProcessDetector {
    pub fn new() -> Self {
        Self {
            system: System::new(),
            known: KnownPids::default(),
            metrics: None,
        }
    }

    pub fn with_metrics(metrics: Arc<DetectionMetrics>) -> Self {
        Self {
            metrics: Some(metrics),
            ..Self::new()
        }
    }

    /// PID of `VALORANT-Win64-Shipping.exe` from the last detection, if running.
    pub fn valorant_pid(&self) -> Option<u32> {
        self.known.valorant
    }

    pub fn detect(&mut self) -> ProcessSignals {
        if let ScanPlan::Known(pids) = plan_scan(self.known) {
            let signals = self.refresh_known(&pids);
            if signals.riot_client_running && signals.valorant_running {
                return signals;
            }
            // One of them exited (or its PID was reused): fall through.
        }
        self.full_scan()
    }

    fn count_scan(&self) {
        if let Some(metrics) = &self.metrics {
            metrics.process_scans.record();
        }
    }

    fn refresh_known(&mut self, pids: &[u32]) -> ProcessSignals {
        self.count_scan();
        let targets: Vec<Pid> = pids.iter().copied().map(Pid::from_u32).collect();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&targets),
            true,
            ProcessRefreshKind::nothing(),
        );
        let mut signals = ProcessSignals::default();
        for pid in &targets {
            // Re-check the name so a recycled PID doesn't count as a match.
            if let Some(process) = self.system.process(*pid) {
                record_process_name(&mut signals, &process.name().to_string_lossy());
            }
        }
        signals
    }

    fn full_scan(&mut self) -> ProcessSignals {
        self.count_scan();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        let mut signals = ProcessSignals::default();
        let mut pids = KnownPids::default();
        for (pid, process) in self.system.processes() {
            if record_process(
                &mut signals,
                &mut pids,
                &process.name().to_string_lossy(),
                pid.as_u32(),
            ) {
                break;
            }
        }
        self.known = pids;
        signals
    }
}

impl Default for ProcessDetector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_pids_are_only_trusted_when_both_are_present() {
        assert_eq!(plan_scan(KnownPids::default()), ScanPlan::Full);
        assert_eq!(
            plan_scan(KnownPids {
                riot_client: Some(10),
                valorant: None
            }),
            ScanPlan::Full
        );
        assert_eq!(
            plan_scan(KnownPids {
                riot_client: None,
                valorant: Some(20)
            }),
            ScanPlan::Full
        );
        assert_eq!(
            plan_scan(KnownPids {
                riot_client: Some(10),
                valorant: Some(20)
            }),
            ScanPlan::Known(vec![10, 20])
        );
    }

    #[test]
    fn record_process_remembers_pids_by_name() {
        let mut signals = ProcessSignals::default();
        let mut pids = KnownPids::default();
        assert!(!record_process(&mut signals, &mut pids, "explorer.exe", 1));
        assert!(!record_process(
            &mut signals,
            &mut pids,
            "RiotClientServices.exe",
            10
        ));
        assert_eq!(pids.riot_client, Some(10));
        assert_eq!(pids.valorant, None);
        assert!(record_process(
            &mut signals,
            &mut pids,
            "VALORANT-Win64-Shipping.exe",
            20
        ));
        assert_eq!(pids.valorant, Some(20));
        // A second process with the same name doesn't overwrite the first PID.
        record_process(&mut signals, &mut pids, "RiotClientServices.exe", 99);
        assert_eq!(pids.riot_client, Some(10));
    }
}
