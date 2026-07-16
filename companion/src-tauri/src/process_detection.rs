use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

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

pub struct ProcessDetector {
    system: System,
}

impl ProcessDetector {
    pub fn new() -> Self {
        Self {
            system: System::new(),
        }
    }

    pub fn detect(&mut self) -> ProcessSignals {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );

        let mut signals = ProcessSignals::default();
        for process in self.system.processes().values() {
            if record_process_name(&mut signals, &process.name().to_string_lossy()) {
                break;
            }
        }
        signals
    }
}

impl Default for ProcessDetector {
    fn default() -> Self {
        Self::new()
    }
}
