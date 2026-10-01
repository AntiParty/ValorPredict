//! Connecting a Twitch account with a pasted connection code (hosted sign-in).
//!
//! The streamer signs in on the broker's web page, copies a sealed `vp1_…` code,
//! and the app redeems it here. All the logic lives in this crate (rather than the
//! Tauri shell) so it can be tested without a window.

use thiserror::Error;

use crate::db::{Db, DbError, SafeUser, UpsertUser};
use crate::predictions::REAUTH_REQUIRED_KEY;
use crate::twitch::{TwitchClient, TwitchError};

/// Every connection code starts with this. Anything else on the clipboard is not ours.
pub const CODE_PREFIX: &str = "vp1_";
/// The broker rejects bodies over 2 KB; real codes are roughly 700 characters.
const MAX_CODE_LEN: usize = 1800;

#[derive(Debug, Error)]
pub enum ConnectError {
    /// Safe to show to the user. Never contains the code.
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Twitch(#[from] TwitchError),
    #[error(transparent)]
    Db(#[from] DbError),
}

/// Trim whitespace/quotes and check the code looks like ours, without contacting anyone.
pub fn normalize_code(raw: &str) -> Result<String, ConnectError> {
    let code = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`').trim();
    if !code.starts_with(CODE_PREFIX) {
        return Err(ConnectError::Message(
            "That isn't a ValorPredict connection code. Click Connect Twitch, then copy the code from the page that opens."
                .into(),
        ));
    }
    if code.len() > MAX_CODE_LEN || code.chars().any(char::is_whitespace) {
        return Err(ConnectError::Message(
            "That doesn't look like a complete connection code. Copy a fresh one and try again.".into(),
        ));
    }
    Ok(code.to_string())
}

/// Redeem a connection code, look up who it belongs to, and store the account.
/// Returns only the safe (token-free) user.
pub async fn import_connection_code(
    twitch: &TwitchClient,
    db: &Db,
    raw_code: &str,
) -> Result<SafeUser, ConnectError> {
    let code = normalize_code(raw_code)?;
    let token = twitch.redeem_connection_code(&code).await?;
    // Ask Twitch directly: the app talks to Helix itself, the broker never sees this.
    let profile = twitch.get_current_user(&token.access_token).await?;

    let user = db.upsert_user(UpsertUser {
        twitch_user_id: profile.id,
        twitch_login: profile.login,
        twitch_display_name: profile.display_name,
        twitch_profile_image_url: profile.profile_image_url,
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_default(),
        token_expires_at: TwitchClient::token_expires_at(token.expires_in),
    })?;
    db.ensure_default_presets(&user.twitch_user_id)?;
    db.set_config(REAUTH_REQUIRED_KEY, "0")?;
    Ok(user)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::twitch::TwitchConfig;
    use httpmock::prelude::*;
    use serde_json::json;

    fn hosted(server: &MockServer) -> TwitchClient {
        let mut config = TwitchConfig::hosted("shared-id".into(), server.base_url());
        config.id_base_url = server.base_url();
        config.api_base_url = server.base_url();
        TwitchClient::new(config)
    }

    #[test]
    fn normalizes_and_rejects_codes() {
        assert_eq!(normalize_code("  vp1_abc-_123\n").unwrap(), "vp1_abc-_123");
        assert_eq!(normalize_code("\"vp1_abc\"").unwrap(), "vp1_abc");
        for bad in ["", "hello", "abc vp1_x", "vp2_abc", "vp1_a b", &format!("vp1_{}", "a".repeat(2000))] {
            let err = normalize_code(bad).unwrap_err();
            assert!(matches!(err, ConnectError::Message(_)), "{bad:?}");
            // Whatever was on the clipboard must never be echoed back.
            if bad.len() > 3 {
                assert!(!err.to_string().contains(bad), "{bad:?}");
            }
        }
    }

    #[tokio::test]
    async fn imports_a_code_and_stores_the_account() {
        let server = MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(POST).path("/api/redeem").json_body(json!({ "code": "vp1_good" }));
                then.status(200).json_body(json!({
                    "access_token": "acc", "refresh_token": "ref", "expires_in": 12000
                }));
            })
            .await;
        server
            .mock_async(|when, then| {
                when.method(GET)
                    .path("/helix/users")
                    .header("Client-Id", "shared-id")
                    .header("Authorization", "Bearer acc");
                then.status(200).json_body(json!({
                    "data": [{ "id": "42", "login": "ace", "display_name": "Ace" }]
                }));
            })
            .await;
        let db = Db::open_in_memory().unwrap();
        db.set_config(REAUTH_REQUIRED_KEY, "1").unwrap();

        let user = import_connection_code(&hosted(&server), &db, " vp1_good \n")
            .await
            .unwrap();

        assert_eq!(user.twitch_login, "ace");
        let tokens = db.get_tokens().unwrap().unwrap();
        assert_eq!(tokens.access_token, "acc");
        assert_eq!(tokens.refresh_token, "ref");
        assert_eq!(db.get_config(REAUTH_REQUIRED_KEY).unwrap().as_deref(), Some("0"));
        // Default presets are created so the dashboard is usable straight away.
        assert!(db.get_preset("42", "competitive").unwrap().is_some());
    }

    #[tokio::test]
    async fn expired_code_gives_the_friendly_message_and_stores_nothing() {
        let server = MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(POST).path("/api/redeem");
                then.status(410).json_body(json!({ "error": "expired" }));
            })
            .await;
        let db = Db::open_in_memory().unwrap();

        let err = import_connection_code(&hosted(&server), &db, "vp1_old")
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "That code expired — click Connect Twitch again.");
        assert!(db.get_tokens().unwrap().is_none());
    }

    #[tokio::test]
    async fn non_code_text_never_reaches_the_network() {
        // No mock server routes at all: a request would fail the test with a network error.
        let server = MockServer::start_async().await;
        let db = Db::open_in_memory().unwrap();
        let err = import_connection_code(&hosted(&server), &db, "my password is hunter2")
            .await
            .unwrap_err();
        assert!(matches!(err, ConnectError::Message(_)));
        assert!(!err.to_string().contains("hunter2"));
    }
}
