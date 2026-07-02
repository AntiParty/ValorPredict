//! SQLite persistence for the single-user desktop app.
//!
//! Ported from the Node `AppDatabase` but trimmed to what the local app needs:
//! one connected user, the two game-mode presets, prediction sessions, and an
//! event log. The hosted-service tables (duo, public showcase, local API keys,
//! legacy settings) are intentionally gone.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    NotFound(&'static str),
}

pub type Result<T> = std::result::Result<T, DbError>;

/// User fields safe to send to the client (no Twitch tokens).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SafeUser {
    pub id: i64,
    pub twitch_user_id: String,
    pub twitch_login: String,
    pub twitch_display_name: String,
    pub twitch_profile_image_url: Option<String>,
    pub token_expires_at: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Twitch tokens for a user — kept inside the process, never serialized out.
#[derive(Debug, Clone, PartialEq)]
pub struct Tokens {
    pub twitch_user_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub token_expires_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Preset {
    pub id: i64,
    pub twitch_user_id: String,
    pub game_mode: String,
    pub enabled: i64,
    pub title_template: String,
    pub outcome_a: String,
    pub outcome_b: String,
    pub prediction_window: i64,
    /// Which outcome ("A" or "B") represents the streamer winning the match.
    /// Used to auto-resolve the prediction from the detected match result.
    pub win_outcome: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PredictionSession {
    pub id: i64,
    pub twitch_user_id: String,
    pub status: String,
    pub twitch_prediction_id: Option<String>,
    #[serde(skip_serializing)]
    pub outcome_a_id: Option<String>,
    #[serde(skip_serializing)]
    pub outcome_b_id: Option<String>,
    /// Display names of the two outcomes (from the preset that opened the
    /// prediction), so the UI can label its resolve buttons.
    pub outcome_a_label: String,
    pub outcome_b_label: String,
    pub title: String,
    pub started_at: Option<String>,
    pub resolved_at: Option<String>,
    pub result: Option<String>,
    pub channel_points_wagered: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PredictionEvent {
    pub id: i64,
    pub twitch_user_id: String,
    pub session_id: Option<i64>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub message: String,
    pub created_at: String,
}

pub struct UpsertUser {
    pub twitch_user_id: String,
    pub twitch_login: String,
    pub twitch_display_name: String,
    pub twitch_profile_image_url: Option<String>,
    pub access_token: String,
    pub refresh_token: String,
    pub token_expires_at: String,
}

pub struct PresetInput {
    pub enabled: bool,
    pub title_template: String,
    pub outcome_a: String,
    pub outcome_b: String,
    pub prediction_window: i64,
    pub win_outcome: String,
}

/// Partial update for a prediction session. `status` is always written; any
/// `None` field keeps the session's current value.
#[derive(Default)]
pub struct SessionUpdate {
    pub status: String,
    pub twitch_prediction_id: Option<String>,
    pub outcome_a_id: Option<String>,
    pub outcome_b_id: Option<String>,
    pub started_at: Option<String>,
    pub resolved_at: Option<String>,
    pub result: Option<String>,
    pub channel_points_wagered: Option<i64>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        // execute_batch tolerates pragmas like journal_mode that return a row.
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twitch_user_id TEXT NOT NULL UNIQUE,
                twitch_login TEXT NOT NULL,
                twitch_display_name TEXT NOT NULL DEFAULT '',
                twitch_profile_image_url TEXT,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                token_expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS auto_prediction_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twitch_user_id TEXT NOT NULL,
                game_mode TEXT NOT NULL CHECK(game_mode IN ('competitive', 'custom')),
                enabled INTEGER NOT NULL DEFAULT 0,
                title_template TEXT NOT NULL,
                outcome_a TEXT NOT NULL,
                outcome_b TEXT NOT NULL,
                prediction_window INTEGER NOT NULL,
                win_outcome TEXT NOT NULL DEFAULT 'A',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(twitch_user_id, game_mode)
            );

            CREATE TABLE IF NOT EXISTS prediction_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twitch_user_id TEXT NOT NULL,
                status TEXT NOT NULL,
                twitch_prediction_id TEXT,
                outcome_a_id TEXT,
                outcome_b_id TEXT,
                outcome_a_label TEXT NOT NULL DEFAULT '',
                outcome_b_label TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                started_at TEXT,
                resolved_at TEXT,
                result TEXT,
                channel_points_wagered INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS one_active_prediction_per_streamer
                ON prediction_sessions(twitch_user_id)
                WHERE status IN ('creating', 'prediction_open');

            CREATE TABLE IF NOT EXISTS prediction_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twitch_user_id TEXT NOT NULL,
                session_id INTEGER,
                type TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(session_id) REFERENCES prediction_sessions(id)
            );

            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        // Backfill win_outcome on databases created before the column existed.
        // Errors (e.g. "duplicate column" on fresh databases) are expected and
        // intentionally ignored.
        let _ = conn.execute(
            "ALTER TABLE auto_prediction_presets ADD COLUMN win_outcome TEXT NOT NULL DEFAULT 'A'",
            [],
        );
        // Same backfill pattern for the outcome display labels on sessions.
        let _ = conn.execute(
            "ALTER TABLE prediction_sessions ADD COLUMN outcome_a_label TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE prediction_sessions ADD COLUMN outcome_b_label TEXT NOT NULL DEFAULT ''",
            [],
        );
        Ok(())
    }

    // ---- users -------------------------------------------------------------

    pub fn upsert_user(&self, input: UpsertUser) -> Result<SafeUser> {
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                r#"
                INSERT INTO users (
                    twitch_user_id, twitch_login, twitch_display_name,
                    twitch_profile_image_url, access_token, refresh_token, token_expires_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(twitch_user_id) DO UPDATE SET
                    twitch_login = excluded.twitch_login,
                    twitch_display_name = excluded.twitch_display_name,
                    twitch_profile_image_url = excluded.twitch_profile_image_url,
                    access_token = excluded.access_token,
                    refresh_token = excluded.refresh_token,
                    token_expires_at = excluded.token_expires_at,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![
                    input.twitch_user_id,
                    input.twitch_login,
                    if input.twitch_display_name.is_empty() {
                        &input.twitch_login
                    } else {
                        &input.twitch_display_name
                    },
                    input.twitch_profile_image_url,
                    input.access_token,
                    input.refresh_token,
                    input.token_expires_at,
                ],
            )?;
        }
        self.get_user_by_twitch_id(&input.twitch_user_id)?
            .ok_or(DbError::NotFound("user"))
    }

    /// The currently connected user (most recently updated). Single-user app.
    pub fn get_user(&self) -> Result<Option<SafeUser>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, twitch_user_id, twitch_login, twitch_display_name, \
             twitch_profile_image_url, token_expires_at, created_at, updated_at \
             FROM users ORDER BY updated_at DESC, id DESC LIMIT 1",
            [],
            map_safe_user,
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn get_user_by_twitch_id(&self, twitch_user_id: &str) -> Result<Option<SafeUser>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, twitch_user_id, twitch_login, twitch_display_name, \
             twitch_profile_image_url, token_expires_at, created_at, updated_at \
             FROM users WHERE twitch_user_id = ?1",
            params![twitch_user_id],
            map_safe_user,
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn get_tokens(&self) -> Result<Option<Tokens>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT twitch_user_id, access_token, refresh_token, token_expires_at \
             FROM users ORDER BY updated_at DESC, id DESC LIMIT 1",
            [],
            |row| {
                Ok(Tokens {
                    twitch_user_id: row.get(0)?,
                    access_token: row.get(1)?,
                    refresh_token: row.get(2)?,
                    token_expires_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn update_tokens(
        &self,
        twitch_user_id: &str,
        access_token: &str,
        refresh_token: &str,
        token_expires_at: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET access_token = ?1, refresh_token = ?2, \
             token_expires_at = ?3, updated_at = CURRENT_TIMESTAMP \
             WHERE twitch_user_id = ?4",
            params![access_token, refresh_token, token_expires_at, twitch_user_id],
        )?;
        Ok(())
    }

    // ---- presets -----------------------------------------------------------

    pub fn ensure_default_presets(&self, twitch_user_id: &str) -> Result<Vec<Preset>> {
        const TITLE: &str = "Will {streamer} win this Valorant match?";
        {
            let conn = self.conn.lock().unwrap();
            let mut insert = conn.prepare(
                "INSERT OR IGNORE INTO auto_prediction_presets (
                    twitch_user_id, game_mode, enabled, title_template,
                    outcome_a, outcome_b, prediction_window, win_outcome
                 ) VALUES (?1, ?2, 0, ?3, 'Yes', 'No', 90, 'A')",
            )?;
            insert.execute(params![twitch_user_id, "competitive", TITLE])?;
            insert.execute(params![twitch_user_id, "custom", TITLE])?;
        }
        self.get_presets(twitch_user_id)
    }

    pub fn get_presets(&self, twitch_user_id: &str) -> Result<Vec<Preset>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, twitch_user_id, game_mode, enabled, title_template, \
             outcome_a, outcome_b, prediction_window, win_outcome, created_at, updated_at \
             FROM auto_prediction_presets WHERE twitch_user_id = ?1 \
             ORDER BY CASE game_mode WHEN 'competitive' THEN 0 ELSE 1 END",
        )?;
        let rows = stmt
            .query_map(params![twitch_user_id], map_preset)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_preset(&self, twitch_user_id: &str, game_mode: &str) -> Result<Option<Preset>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, twitch_user_id, game_mode, enabled, title_template, \
             outcome_a, outcome_b, prediction_window, win_outcome, created_at, updated_at \
             FROM auto_prediction_presets WHERE twitch_user_id = ?1 AND game_mode = ?2",
            params![twitch_user_id, game_mode],
            map_preset,
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn save_preset(
        &self,
        twitch_user_id: &str,
        game_mode: &str,
        input: PresetInput,
    ) -> Result<Preset> {
        self.ensure_default_presets(twitch_user_id)?;
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE auto_prediction_presets SET \
                 enabled = ?1, title_template = ?2, outcome_a = ?3, outcome_b = ?4, \
                 prediction_window = ?5, win_outcome = ?6, updated_at = CURRENT_TIMESTAMP \
                 WHERE twitch_user_id = ?7 AND game_mode = ?8",
                params![
                    input.enabled as i64,
                    input.title_template,
                    input.outcome_a,
                    input.outcome_b,
                    input.prediction_window,
                    input.win_outcome,
                    twitch_user_id,
                    game_mode,
                ],
            )?;
        }
        self.get_preset(twitch_user_id, game_mode)?
            .ok_or(DbError::NotFound("preset"))
    }

    // ---- prediction sessions ----------------------------------------------

    pub fn create_session(
        &self,
        twitch_user_id: &str,
        title: &str,
        outcome_a_label: &str,
        outcome_b_label: &str,
    ) -> Result<PredictionSession> {
        let id = {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO prediction_sessions \
                 (twitch_user_id, status, title, outcome_a_label, outcome_b_label) \
                 VALUES (?1, 'creating', ?2, ?3, ?4)",
                params![twitch_user_id, title, outcome_a_label, outcome_b_label],
            )?;
            conn.last_insert_rowid()
        };
        self.get_session(id)?.ok_or(DbError::NotFound("session"))
    }

    pub fn get_session(&self, id: i64) -> Result<Option<PredictionSession>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, twitch_user_id, status, twitch_prediction_id, outcome_a_id, \
             outcome_b_id, title, started_at, resolved_at, result, \
             channel_points_wagered, created_at, updated_at, \
             outcome_a_label, outcome_b_label \
             FROM prediction_sessions WHERE id = ?1",
            params![id],
            map_session,
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn get_active_session(&self, twitch_user_id: &str) -> Result<Option<PredictionSession>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, twitch_user_id, status, twitch_prediction_id, outcome_a_id, \
             outcome_b_id, title, started_at, resolved_at, result, \
             channel_points_wagered, created_at, updated_at, \
             outcome_a_label, outcome_b_label \
             FROM prediction_sessions \
             WHERE twitch_user_id = ?1 AND status IN ('creating', 'prediction_open') \
             ORDER BY id DESC LIMIT 1",
            params![twitch_user_id],
            map_session,
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn update_session(&self, id: i64, update: SessionUpdate) -> Result<PredictionSession> {
        let current = self.get_session(id)?.ok_or(DbError::NotFound("session"))?;
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE prediction_sessions SET \
                 status = ?1, twitch_prediction_id = ?2, outcome_a_id = ?3, \
                 outcome_b_id = ?4, started_at = ?5, resolved_at = ?6, result = ?7, \
                 channel_points_wagered = ?8, updated_at = CURRENT_TIMESTAMP \
                 WHERE id = ?9",
                params![
                    update.status,
                    update.twitch_prediction_id.or(current.twitch_prediction_id),
                    update.outcome_a_id.or(current.outcome_a_id),
                    update.outcome_b_id.or(current.outcome_b_id),
                    update.started_at.or(current.started_at),
                    update.resolved_at.or(current.resolved_at),
                    update.result.or(current.result),
                    update
                        .channel_points_wagered
                        .unwrap_or(current.channel_points_wagered),
                    id,
                ],
            )?;
        }
        self.get_session(id)?.ok_or(DbError::NotFound("session"))
    }

    // ---- events ------------------------------------------------------------

    pub fn add_event(
        &self,
        twitch_user_id: &str,
        session_id: Option<i64>,
        event_type: &str,
        message: &str,
    ) -> Result<PredictionEvent> {
        let id = {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO prediction_events (twitch_user_id, session_id, type, message) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![twitch_user_id, session_id, event_type, message],
            )?;
            conn.last_insert_rowid()
        };
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, twitch_user_id, session_id, type, message, created_at \
             FROM prediction_events WHERE id = ?1",
            params![id],
            map_event,
        )
        .map_err(DbError::from)
    }

    // ---- app config (Twitch credentials, etc.) ----------------------------

    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO app_config (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_config(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn save_twitch_credentials(&self, client_id: &str, client_secret: &str) -> Result<()> {
        self.set_config("twitch_client_id", client_id)?;
        self.set_config("twitch_client_secret", client_secret)?;
        Ok(())
    }

    /// Returns the saved (client_id, client_secret) only when both are present.
    pub fn get_twitch_credentials(&self) -> Result<Option<(String, String)>> {
        let id = self.get_config("twitch_client_id")?;
        let secret = self.get_config("twitch_client_secret")?;
        Ok(match (id, secret) {
            (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Some((id, secret)),
            _ => None,
        })
    }

    pub fn get_recent_events(
        &self,
        twitch_user_id: &str,
        limit: i64,
    ) -> Result<Vec<PredictionEvent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, twitch_user_id, session_id, type, message, created_at \
             FROM prediction_events WHERE twitch_user_id = ?1 \
             ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![twitch_user_id, limit], map_event)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

fn map_safe_user(row: &Row) -> rusqlite::Result<SafeUser> {
    Ok(SafeUser {
        id: row.get(0)?,
        twitch_user_id: row.get(1)?,
        twitch_login: row.get(2)?,
        twitch_display_name: row.get(3)?,
        twitch_profile_image_url: row.get(4)?,
        token_expires_at: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_preset(row: &Row) -> rusqlite::Result<Preset> {
    Ok(Preset {
        id: row.get(0)?,
        twitch_user_id: row.get(1)?,
        game_mode: row.get(2)?,
        enabled: row.get(3)?,
        title_template: row.get(4)?,
        outcome_a: row.get(5)?,
        outcome_b: row.get(6)?,
        prediction_window: row.get(7)?,
        win_outcome: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn map_session(row: &Row) -> rusqlite::Result<PredictionSession> {
    Ok(PredictionSession {
        id: row.get(0)?,
        twitch_user_id: row.get(1)?,
        status: row.get(2)?,
        twitch_prediction_id: row.get(3)?,
        outcome_a_id: row.get(4)?,
        outcome_b_id: row.get(5)?,
        title: row.get(6)?,
        started_at: row.get(7)?,
        resolved_at: row.get(8)?,
        result: row.get(9)?,
        channel_points_wagered: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        outcome_a_label: row.get(13)?,
        outcome_b_label: row.get(14)?,
    })
}

fn map_event(row: &Row) -> rusqlite::Result<PredictionEvent> {
    Ok(PredictionEvent {
        id: row.get(0)?,
        twitch_user_id: row.get(1)?,
        session_id: row.get(2)?,
        event_type: row.get(3)?,
        message: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_user() -> UpsertUser {
        UpsertUser {
            twitch_user_id: "123".into(),
            twitch_login: "ace".into(),
            twitch_display_name: "Ace Player".into(),
            twitch_profile_image_url: Some("https://static.example/ace.png".into()),
            access_token: "access-secret".into(),
            refresh_token: "refresh-secret".into(),
            token_expires_at: "2030-01-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn upserts_user_and_keeps_tokens_internal() {
        let db = Db::open_in_memory().unwrap();
        let user = db.upsert_user(sample_user()).unwrap();
        assert_eq!(user.twitch_login, "ace");
        assert_eq!(user.twitch_display_name, "Ace Player");

        // Tokens are never part of the safe user, but are retrievable internally.
        let json = serde_json::to_string(&user).unwrap();
        assert!(!json.contains("access-secret"));
        let tokens = db.get_tokens().unwrap().unwrap();
        assert_eq!(tokens.access_token, "access-secret");

        // Re-login updates in place rather than duplicating.
        db.upsert_user(UpsertUser {
            twitch_login: "ace2".into(),
            ..sample_user()
        })
        .unwrap();
        assert_eq!(db.get_user().unwrap().unwrap().twitch_login, "ace2");
    }

    #[test]
    fn ensures_two_default_presets_and_saves_one() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_user(sample_user()).unwrap();

        let presets = db.ensure_default_presets("123").unwrap();
        assert_eq!(presets.len(), 2);
        assert_eq!(presets[0].game_mode, "competitive");
        assert_eq!(presets[1].game_mode, "custom");

        let saved = db
            .save_preset(
                "123",
                "competitive",
                PresetInput {
                    enabled: true,
                    title_template: "Clutch for {streamer}?".into(),
                    outcome_a: "Win".into(),
                    outcome_b: "Loss".into(),
                    prediction_window: 120,
                    win_outcome: "A".into(),
                },
            )
            .unwrap();
        assert_eq!(saved.enabled, 1);
        assert_eq!(saved.title_template, "Clutch for {streamer}?");
        assert_eq!(saved.prediction_window, 120);
        // Other preset untouched.
        assert_eq!(db.get_preset("123", "custom").unwrap().unwrap().enabled, 0);
    }

    #[test]
    fn prediction_session_lifecycle_and_events() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_user(sample_user()).unwrap();

        let session = db.create_session("123", "Will ace win?", "Yes", "No").unwrap();
        assert_eq!(session.status, "creating");
        assert_eq!(session.outcome_a_label, "Yes");
        assert_eq!(session.outcome_b_label, "No");
        assert_eq!(
            db.get_active_session("123").unwrap().unwrap().id,
            session.id
        );

        let resolved = db
            .update_session(
                session.id,
                SessionUpdate {
                    status: "resolved".into(),
                    result: Some("A".into()),
                    channel_points_wagered: Some(1000),
                    resolved_at: Some("2030-01-01T00:05:00.000Z".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(resolved.status, "resolved");
        assert_eq!(resolved.result.as_deref(), Some("A"));
        assert_eq!(resolved.channel_points_wagered, 1000);
        assert!(db.get_active_session("123").unwrap().is_none());

        db.add_event("123", Some(session.id), "prediction_resolved", "done")
            .unwrap();
        let events = db.get_recent_events("123", 5).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "prediction_resolved");
        // serde renames event_type -> "type" for the client.
        let json = serde_json::to_string(&events[0]).unwrap();
        assert!(json.contains("\"type\":\"prediction_resolved\""));
    }

    #[test]
    fn enforces_one_active_session_per_user() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_user(sample_user()).unwrap();
        db.create_session("123", "first", "Yes", "No").unwrap();
        assert!(db.create_session("123", "second", "Yes", "No").is_err());
    }

    #[test]
    fn stores_twitch_credentials() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.get_twitch_credentials().unwrap().is_none());
        db.save_twitch_credentials("client-id", "client-secret").unwrap();
        assert_eq!(
            db.get_twitch_credentials().unwrap().unwrap(),
            ("client-id".to_string(), "client-secret".to_string())
        );
    }

    #[test]
    fn persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("vap.sqlite");
        {
            let db = Db::open(&path).unwrap();
            db.upsert_user(sample_user()).unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.get_user().unwrap().unwrap().twitch_login, "ace");
    }
}
