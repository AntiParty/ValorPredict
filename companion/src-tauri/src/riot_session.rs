//! A Riot session that outlives a single poll: one `RiotLocalClient`, its
//! context (tokens, region, version) and the lockfile identity they belong to.
//!
//! Rebuilt only when the Riot Client restarts (new lockfile pid/port/password)
//! or VALORANT restarts (the client version may have changed). Entitlements are
//! refreshed from the loopback API when Riot's servers reject them, then the
//! call is retried once, and as a backstop every 30 minutes.

use std::{
    fmt,
    time::{Duration, Instant},
};

use crate::{
    riot_local_client::{RiotError, RiotLocalClient, RiotMatchSignal, RiotSessionContext},
    riot_lockfile::Lockfile,
};

/// Refresh entitlements this long after the last refresh even if nothing failed.
pub const ENTITLEMENT_BACKSTOP: Duration = Duration::from_secs(30 * 60);

/// What a cached session was built for.
#[derive(Clone, PartialEq, Eq)]
pub struct SessionKey {
    pub pid: u32,
    pub port: u16,
    pub password: String,
    /// The VALORANT process the session was built while running, if known.
    pub valorant_pid: Option<u32>,
}

impl SessionKey {
    pub fn new(lockfile: &Lockfile, valorant_pid: Option<u32>) -> Self {
        Self {
            pid: lockfile.pid,
            port: lockfile.port,
            password: lockfile.password.clone(),
            valorant_pid,
        }
    }
}

impl fmt::Debug for SessionKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionKey")
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("password", &"[redacted]")
            .field("valorant_pid", &self.valorant_pid)
            .finish()
    }
}

/// Whether the `cached` session can still serve `current`. The lockfile
/// identity must match exactly. A VALORANT restart invalidates the session
/// (the client version may have changed), but a `current` that doesn't know the
/// VALORANT pid (result lookups after the game closed) accepts any.
pub fn same_session(cached: &SessionKey, current: &SessionKey) -> bool {
    cached.pid == current.pid
        && cached.port == current.port
        && cached.password == current.password
        && (current.valorant_pid.is_none() || cached.valorant_pid == current.valorant_pid)
}

pub fn entitlements_stale(age: Duration) -> bool {
    age >= ENTITLEMENT_BACKSTOP
}

pub struct RiotSession {
    key: SessionKey,
    client: RiotLocalClient,
    context: RiotSessionContext,
    entitlements_at: Instant,
    /// Set when Riot still rejected the tokens after a refresh and retry. The
    /// cache then rebuilds the whole session (client version included).
    needs_rebuild: bool,
}

impl RiotSession {
    /// Build the session, reading the VALORANT log only if the API can't say.
    pub async fn open(key: SessionKey, client: RiotLocalClient) -> Result<Self, String> {
        let context = client.session_context().await?;
        Ok(Self::from_parts(key, client, context))
    }

    /// As `open`, with the log reader injected (tests).
    pub async fn open_with<F>(
        key: SessionKey,
        client: RiotLocalClient,
        read_log: F,
    ) -> Result<Self, String>
    where
        F: FnOnce() -> Option<String>,
    {
        let context = client.session_context_with(read_log).await?;
        Ok(Self::from_parts(key, client, context))
    }

    fn from_parts(key: SessionKey, client: RiotLocalClient, context: RiotSessionContext) -> Self {
        Self {
            key,
            client,
            context,
            entitlements_at: Instant::now(),
            needs_rebuild: false,
        }
    }

    pub fn needs_rebuild(&self) -> bool {
        self.needs_rebuild
    }

    fn note_retry<T>(&mut self, result: Result<T, RiotError>) -> Result<T, String> {
        if matches!(result, Err(RiotError::AuthExpired(_))) {
            self.needs_rebuild = true;
        }
        Ok(result?)
    }

    pub fn key(&self) -> &SessionKey {
        &self.key
    }

    pub fn context(&self) -> &RiotSessionContext {
        &self.context
    }

    pub async fn current_game(&mut self) -> Result<Option<RiotMatchSignal>, String> {
        self.refresh_if_stale().await?;
        let first = self.client.get_current_game_match(&self.context).await;
        match first {
            Err(RiotError::AuthExpired(_)) => {
                self.refresh_entitlements().await?;
                let retry = self.client.get_current_game_match(&self.context).await;
                self.note_retry(retry)
            }
            other => Ok(other?),
        }
    }

    pub async fn pregame(&mut self) -> Result<Option<RiotMatchSignal>, String> {
        self.refresh_if_stale().await?;
        let first = self.client.get_pregame_match(&self.context).await;
        match first {
            Err(RiotError::AuthExpired(_)) => {
                self.refresh_entitlements().await?;
                let retry = self.client.get_pregame_match(&self.context).await;
                self.note_retry(retry)
            }
            other => Ok(other?),
        }
    }

    pub async fn match_result(&mut self, match_id: &str) -> Result<Option<bool>, String> {
        self.refresh_if_stale().await?;
        let first = self.client.get_match_result(match_id, &self.context).await;
        match first {
            Err(RiotError::AuthExpired(_)) => {
                self.refresh_entitlements().await?;
                let retry = self.client.get_match_result(match_id, &self.context).await;
                self.note_retry(retry)
            }
            other => Ok(other?),
        }
    }

    async fn refresh_if_stale(&mut self) -> Result<(), String> {
        if entitlements_stale(self.entitlements_at.elapsed()) {
            self.refresh_entitlements().await?;
        }
        Ok(())
    }

    /// Re-read `/entitlements/v1/token`. Region, shard and client version stay
    /// cached, unless a different account signed in (new puuid), in which case
    /// the whole context is rebuilt.
    async fn refresh_entitlements(&mut self) -> Result<(), String> {
        let fresh = self.client.fetch_entitlements().await?;
        if fresh.puuid == self.context.puuid {
            self.context.access_token = fresh.access_token;
            self.context.entitlement_token = fresh.entitlement_token;
        } else {
            self.context = self.client.session_context().await?;
        }
        self.entitlements_at = Instant::now();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(pid: u32, port: u16, password: &str, valorant: Option<u32>) -> SessionKey {
        SessionKey {
            pid,
            port,
            password: password.into(),
            valorant_pid: valorant,
        }
    }

    #[test]
    fn session_is_reused_only_for_the_same_lockfile_identity() {
        let cached = key(1, 5000, "pw", Some(7));
        assert!(same_session(&cached, &key(1, 5000, "pw", Some(7))));
        assert!(!same_session(&cached, &key(2, 5000, "pw", Some(7))));
        assert!(!same_session(&cached, &key(1, 5001, "pw", Some(7))));
        assert!(!same_session(&cached, &key(1, 5000, "other", Some(7))));
    }

    #[test]
    fn valorant_restart_invalidates_but_unknown_pid_does_not() {
        let cached = key(1, 5000, "pw", Some(7));
        assert!(!same_session(&cached, &key(1, 5000, "pw", Some(8))));
        assert!(same_session(&cached, &key(1, 5000, "pw", None)));
    }

    #[test]
    fn debug_output_hides_the_password() {
        assert!(!format!("{:?}", key(1, 5000, "super-secret", None)).contains("super-secret"));
    }

    #[test]
    fn entitlements_go_stale_after_thirty_minutes() {
        assert!(!entitlements_stale(Duration::from_secs(29 * 60 + 59)));
        assert!(entitlements_stale(Duration::from_secs(30 * 60)));
    }
}
