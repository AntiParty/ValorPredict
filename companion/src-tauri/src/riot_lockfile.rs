use std::{fmt, fs, path::PathBuf};

#[derive(Clone)]
pub struct Lockfile {
    pub name: String,
    pub pid: u32,
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

impl Lockfile {
    pub fn parse(contents: &str) -> Result<Self, String> {
        let parts: Vec<&str> = contents.trim().split(':').collect();
        if parts.len() != 5 {
            return Err("Riot lockfile must contain exactly five fields.".into());
        }
        let pid = parts[1]
            .parse()
            .map_err(|_| "Riot lockfile PID is invalid.".to_string())?;
        let port = parts[2]
            .parse()
            .map_err(|_| "Riot lockfile port is invalid.".to_string())?;
        if parts[3].is_empty() || !matches!(parts[4], "http" | "https") {
            return Err("Riot lockfile credentials or protocol are invalid.".into());
        }
        Ok(Self {
            name: parts[0].into(),
            pid,
            port,
            password: parts[3].into(),
            protocol: parts[4].into(),
        })
    }

    pub fn local_base_url(&self) -> String {
        format!("{}://127.0.0.1:{}", self.protocol, self.port)
    }
}

impl fmt::Debug for Lockfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Lockfile")
            .field("name", &self.name)
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("password", &"[redacted]")
            .field("protocol", &self.protocol)
            .finish()
    }
}

pub fn default_lockfile_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| {
        base.join("Riot Games")
            .join("Riot Client")
            .join("Config")
            .join("lockfile")
    })
}

pub fn read_lockfile() -> Result<Option<Lockfile>, String> {
    let Some(path) = default_lockfile_path() else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read Riot lockfile: {error}"))?;
    Lockfile::parse(&contents).map(Some)
}
