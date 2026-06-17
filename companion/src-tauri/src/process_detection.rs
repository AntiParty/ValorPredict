use sysinfo::System;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProcessSignals {
    pub riot_client_running: bool,
    pub valorant_running: bool,
}

pub fn detect_processes() -> ProcessSignals {
    let system = System::new_all();
    let process_names: Vec<String> = system
        .processes()
        .values()
        .map(|process| process.name().to_string_lossy().to_ascii_lowercase())
        .collect();
    ProcessSignals {
        riot_client_running: process_names
            .iter()
            .any(|name| name == "riotclientservices.exe"),
        valorant_running: process_names
            .iter()
            .any(|name| name == "valorant-win64-shipping.exe"),
    }
}
