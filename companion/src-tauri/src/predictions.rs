//! Local, in-process predictions backend.
//!
//! This is the free/local replacement for the old hosted website. Instead of
//! POSTing detected match starts to a paid remote backend, the companion now
//! owns the whole prediction lifecycle in-process through `vap_core`: a local
//! SQLite database, the Twitch client, and the prediction service.
//!
//! The Tauri commands here mirror the JSON contract the old web dashboard used
//! (`/api/me`, `/api/dashboard`, `/api/presets/:mode`, resolve/cancel, the
//! Twitch settings), but are exposed over Tauri's IPC bridge rather than HTTP —
//! so there is no always-on local web server.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use vap_core::db::{Db, Preset, PresetInput, SafeUser, UpsertUser};
use vap_core::predictions::{PredictionService, Winner};
use vap_core::twitch::{TwitchClient, TwitchConfig};

use crate::commands::{push_log, AppRuntimeState};

/// Fixed loopback port used only for the one-shot Twitch OAuth callback. The
/// user registers `redirect_uri()` (below) in their Twitch application, so this
/// must stay stable across releases. Matches the original project's documented
/// callback (`http://localhost:3000/auth/twitch/callback`) so existing Twitch
/// app registrations keep working.
pub const OAUTH_PORT: u16 = 3000;

/// The OAuth redirect URL the user must add to their Twitch application.
pub fn redirect_uri() -> String {
    format!("http://localhost:{OAUTH_PORT}/auth/twitch/callback")
}

/// The Twitch-dependent services, present only once credentials are configured.
/// Cheaply cloneable (just `Arc`s) so it can be lifted out of the lock and used
/// across `.await` points without holding the guard.
#[derive(Clone)]
pub struct PredictionRuntime {
    pub twitch: Arc<TwitchClient>,
    pub service: Arc<PredictionService>,
}

/// Build the Twitch client + prediction service for the given credentials.
pub fn build_prediction_runtime(
    db: Arc<Db>,
    client_id: String,
    client_secret: String,
) -> PredictionRuntime {
    let config = TwitchConfig::new(client_id, client_secret, redirect_uri());
    let twitch = Arc::new(TwitchClient::new(config));
    let service = Arc::new(PredictionService::new(db, twitch.clone()));
    PredictionRuntime { twitch, service }
}

/// Restore the runtime from saved credentials (used at startup).
pub fn restore_runtime(db: &Arc<Db>) -> Option<PredictionRuntime> {
    db.get_twitch_credentials()
        .ok()
        .flatten()
        .map(|(id, secret)| build_prediction_runtime(db.clone(), id, secret))
}

// ---- shared helpers -------------------------------------------------------

/// Clone the configured runtime out of the lock, or a friendly error.
pub fn current_runtime(state: &AppRuntimeState) -> Result<PredictionRuntime, String> {
    state
        .predictions
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "Add your Twitch application credentials first.".to_string())
}

pub fn is_configured(predictions: &RwLock<Option<PredictionRuntime>>) -> bool {
    predictions.read().unwrap().is_some()
}

fn require_user(state: &AppRuntimeState) -> Result<SafeUser, String> {
    state
        .db
        .get_user()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Connect your Twitch account first.".to_string())
}

fn validate_preset(
    enabled: bool,
    title_template: String,
    outcome_a: String,
    outcome_b: String,
    prediction_window: i64,
    win_outcome: String,
) -> Result<PresetInput, String> {
    let title = title_template.trim().to_string();
    if title.is_empty() || title.chars().count() > 45 {
        return Err("Prediction title must be between 1 and 45 characters.".into());
    }
    let outcome_a = outcome_a.trim().to_string();
    let outcome_b = outcome_b.trim().to_string();
    if outcome_a.is_empty()
        || outcome_b.is_empty()
        || outcome_a.chars().count() > 25
        || outcome_b.chars().count() > 25
    {
        return Err("Each outcome must be between 1 and 25 characters.".into());
    }
    let win_outcome = match win_outcome.trim().to_ascii_uppercase().as_str() {
        "A" => "A".to_string(),
        "B" => "B".to_string(),
        _ => return Err("Winning outcome must be A or B.".into()),
    };
    Ok(PresetInput {
        enabled,
        title_template: title,
        outcome_a,
        outcome_b,
        prediction_window: prediction_window.clamp(30, 1800),
        win_outcome,
    })
}

// ---- read commands --------------------------------------------------------

#[tauri::command]
pub fn get_me(state: State<'_, AppRuntimeState>) -> Value {
    let user = state.db.get_user().ok().flatten();
    json!({
        "user": user,
        "flash": null,
        "configured": is_configured(&state.predictions),
        "redirectUri": redirect_uri(),
    })
}

#[tauri::command]
pub fn get_twitch_settings(state: State<'_, AppRuntimeState>) -> Value {
    json!({
        "configured": is_configured(&state.predictions),
        "redirectUri": redirect_uri(),
    })
}

#[tauri::command]
pub fn get_dashboard(state: State<'_, AppRuntimeState>) -> Result<Value, String> {
    let user = require_user(&state)?;
    let presets = state
        .db
        .ensure_default_presets(&user.twitch_user_id)
        .map_err(|error| error.to_string())?;
    let active = state
        .db
        .get_active_session(&user.twitch_user_id)
        .map_err(|error| error.to_string())?;
    let events = state
        .db
        .get_recent_events(&user.twitch_user_id, 5)
        .map_err(|error| error.to_string())?;

    Ok(json!({
        "user": user,
        "presets": presets,
        "activeSession": active,
        "events": events,
        "developmentMode": cfg!(debug_assertions),
    }))
}

// ---- settings -------------------------------------------------------------

#[tauri::command]
pub fn save_twitch_credentials(
    state: State<'_, AppRuntimeState>,
    client_id: String,
    client_secret: String,
) -> Result<Value, String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return Err("Client ID and secret are required.".into());
    }
    state
        .db
        .save_twitch_credentials(&client_id, &client_secret)
        .map_err(|_| "Could not save credentials.".to_string())?;
    let runtime = build_prediction_runtime(state.db.clone(), client_id, client_secret);
    *state.predictions.write().unwrap() = Some(runtime);
    push_log(
        &state.status,
        "success",
        "Twitch application credentials saved on this PC.",
    );
    Ok(json!({ "ok": true, "configured": true }))
}

// ---- mutations ------------------------------------------------------------

#[tauri::command]
pub fn save_preset(
    state: State<'_, AppRuntimeState>,
    game_mode: String,
    enabled: bool,
    title_template: String,
    outcome_a: String,
    outcome_b: String,
    prediction_window: i64,
    win_outcome: String,
) -> Result<Preset, String> {
    let user = require_user(&state)?;
    if game_mode != "competitive" && game_mode != "custom" {
        return Err("Unsupported game mode.".into());
    }
    let input = validate_preset(
        enabled,
        title_template,
        outcome_a,
        outcome_b,
        prediction_window,
        win_outcome,
    )?;
    state
        .db
        .save_preset(&user.twitch_user_id, &game_mode, input)
        .map_err(|_| "Could not save preset.".to_string())
}

#[tauri::command]
pub async fn resolve_prediction(
    state: State<'_, AppRuntimeState>,
    winner: String,
) -> Result<Value, String> {
    let user = require_user(&state)?;
    let runtime = current_runtime(&state)?;
    let winner = match winner.as_str() {
        "A" => Winner::A,
        "B" => Winner::B,
        _ => return Err("Winner must be A or B.".into()),
    };
    runtime
        .service
        .resolve(&user.twitch_user_id, winner)
        .await
        .map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "message": "Prediction resolved." }))
}

#[tauri::command]
pub async fn cancel_prediction(state: State<'_, AppRuntimeState>) -> Result<Value, String> {
    let user = require_user(&state)?;
    let runtime = current_runtime(&state)?;
    runtime
        .service
        .cancel(&user.twitch_user_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "message": "Prediction cancelled." }))
}

/// Manual trigger used by the in-app developer tools (mirrors the website's
/// `/api/predictions/simulate-match-start/:mode`).
#[tauri::command]
pub async fn simulate_match_start(
    state: State<'_, AppRuntimeState>,
    game_mode: String,
) -> Result<Value, String> {
    let user = require_user(&state)?;
    let runtime = current_runtime(&state)?;
    let result = runtime
        .service
        .handle_match_start(&user.twitch_user_id, "manual", &game_mode)
        .await
        .map_err(|error| error.to_string())?;
    push_log(&state.status, "info", &result.message);
    Ok(json!({
        "ok": true,
        "action": result.action,
        "message": result.message,
    }))
}

// ---- Twitch OAuth (one-shot local listener) -------------------------------

#[tauri::command]
pub async fn connect_twitch(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<SafeUser, String> {
    let runtime = current_runtime(&state)?;
    let oauth_state = uuid::Uuid::new_v4().to_string();
    let auth_url = runtime.twitch.build_authorization_url(&oauth_state);

    // Bind the callback listener *before* opening the browser to avoid a race.
    // `localhost` resolves to IPv6 (::1) or IPv4 (127.0.0.1) depending on the
    // browser/OS (Windows often prefers ::1), so listen on both loopback
    // addresses or the redirect would be refused.
    let v4 = TcpListener::bind((Ipv4Addr::LOCALHOST, OAUTH_PORT)).await.ok();
    let v6 = TcpListener::bind((Ipv6Addr::LOCALHOST, OAUTH_PORT)).await.ok();
    if v4.is_none() && v6.is_none() {
        return Err(format!(
            "Could not start the local sign-in listener on port {OAUTH_PORT}. \
             Is another copy of the app already signing in?"
        ));
    }

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|error| format!("Could not open your browser for Twitch sign-in: {error}"))?;
    push_log(
        &state.status,
        "info",
        "Opened Twitch sign-in in your browser. Waiting for authorization…",
    );

    let code = wait_for_oauth_code(v4, v6, &oauth_state).await?;
    let token = runtime
        .twitch
        .exchange_code(&code)
        .await
        .map_err(|error| error.to_string())?;
    let profile = runtime
        .twitch
        .get_current_user(&token.access_token)
        .await
        .map_err(|error| error.to_string())?;

    let user = state
        .db
        .upsert_user(UpsertUser {
            twitch_user_id: profile.id,
            twitch_login: profile.login,
            twitch_display_name: profile.display_name,
            twitch_profile_image_url: profile.profile_image_url,
            access_token: token.access_token,
            refresh_token: token.refresh_token.unwrap_or_default(),
            token_expires_at: TwitchClient::token_expires_at(token.expires_in),
        })
        .map_err(|error| error.to_string())?;
    let _ = state.db.ensure_default_presets(&user.twitch_user_id);
    push_log(
        &state.status,
        "success",
        &format!("Connected to Twitch as {}.", user.twitch_login),
    );
    Ok(user)
}

/// Accept a single loopback request, send a small "you can close this" page,
/// and return the `code` after validating the `state` parameter.
async fn wait_for_oauth_code(
    v4: Option<TcpListener>,
    v6: Option<TcpListener>,
    expected_state: &str,
) -> Result<String, String> {
    // Accept the first callback on whichever loopback address the browser used.
    let accept = async {
        match (&v4, &v6) {
            (Some(a), Some(b)) => tokio::select! {
                result = a.accept() => result,
                result = b.accept() => result,
            },
            (Some(a), None) => a.accept().await,
            (None, Some(b)) => b.accept().await,
            (None, None) => unreachable!("at least one listener is bound"),
        }
    };
    let (mut stream, _addr) = tokio::time::timeout(Duration::from_secs(180), accept)
        .await
        .map_err(|_| "Timed out waiting for Twitch authorization. Please try again.".to_string())?
        .map_err(|error| format!("Sign-in listener error: {error}"))?;

    // The request line ("GET /path?query HTTP/1.1") fits comfortably in 8 KiB.
    let mut buffer = vec![0u8; 8192];
    let read = stream
        .read(&mut buffer)
        .await
        .map_err(|error| format!("Could not read the Twitch callback: {error}"))?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request.lines().next().unwrap_or("");
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut code: Option<String> = None;
    let mut returned_state: Option<String> = None;
    let mut oauth_error: Option<String> = None;
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            let value = percent_decode(value);
            match key {
                "code" => code = Some(value),
                "state" => returned_state = Some(value),
                "error_description" => oauth_error = Some(value),
                "error" => {
                    oauth_error.get_or_insert(value);
                }
                _ => {}
            }
        }
    }

    let ok = oauth_error.is_none() && code.is_some();
    let page = if ok {
        "<h2>Twitch connected</h2><p>You can close this tab and return to the companion.</p>"
    } else {
        "<h2>Sign-in failed</h2><p>You can close this tab and try again from the companion.</p>"
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>ValorPredict</title>\
         <body style=\"font-family:system-ui,sans-serif;background:#0b0c10;color:#f5f5f4;\
         text-align:center;padding-top:80px\">{page}</body>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    if let Some(message) = oauth_error {
        return Err(format!("Twitch denied the sign-in: {message}"));
    }
    let returned_state =
        returned_state.ok_or_else(|| "Twitch did not return an OAuth state.".to_string())?;
    if returned_state != expected_state {
        return Err("OAuth state mismatch — please try connecting again.".into());
    }
    code.ok_or_else(|| "Twitch did not return an authorization code.".to_string())
}

/// Minimal `application/x-www-form-urlencoded` decode (handles `+` and `%XX`).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hi = (bytes[index + 1] as char).to_digit(16);
                let lo = (bytes[index + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(hi), Some(lo)) => {
                        out.push((hi * 16 + lo) as u8);
                        index += 3;
                    }
                    _ => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
