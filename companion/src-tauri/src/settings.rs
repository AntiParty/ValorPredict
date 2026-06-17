use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::models::AppSettings;

#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<AppSettings, String> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }
        let contents = fs::read_to_string(&self.path)
            .map_err(|error| format!("Could not read companion settings: {error}"))?;
        serde_json::from_str(&contents)
            .map_err(|error| format!("Companion settings are invalid: {error}"))
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create settings directory: {error}"))?;
        }
        let serialized = serde_json::to_string_pretty(settings)
            .map_err(|error| format!("Could not serialize settings: {error}"))?;
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, serialized)
            .map_err(|error| format!("Could not write companion settings: {error}"))?;
        fs::rename(&temporary, &self.path)
            .map_err(|error| format!("Could not replace companion settings: {error}"))
    }
}
