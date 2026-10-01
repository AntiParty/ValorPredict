//! Hosted Twitch sign-in: the streamer signs in on ValorPredict's web page, copies a
//! sealed connection code, and the app redeems it. No Twitch developer account needed.
//!
//! The Twitch Client Secret never reaches this app. It lives on the broker (the
//! open-source `auth/` service), which only ever sees tokens while a request is in
//! flight. The code is read from the clipboard here in Rust and never passed through
//! the webview, so the UI (and anything injected into it) never sees it.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use vap_core::connect;
use vap_core::db::{Db, SafeUser};
use vap_core::predictions::SessionHealth;

use crate::commands::{push_log, AppRuntimeState};
use crate::models::ValorantDetectionStatus;
use crate::predictions::{current_runtime, PredictionRuntime};

/// ValorPredict's shared Twitch application (the Client ID is public by design).
/// Override at build time with the `VALORPREDICT_TWITCH_CLIENT_ID` environment variable.
pub const TWITCH_CLIENT_ID: &str = match option_env!("VALORPREDICT_TWITCH_CLIENT_ID") {
    Some(value) => value,
    None => "y1tibwkcculyfvq9lbkgcmkyp8zlft",
};

/// Where the `auth/` service is deployed: origin only, no trailing slash or path.
/// Override at build time with `VALORPREDICT_BROKER_URL`.
pub const BROKER_BASE_URL: &str = match option_env!("VALORPREDICT_BROKER_URL") {
    Some(value) => value,
    None => "https://valorpredict-auth.vercel.app",
};

/// Twitch asks apps to validate their token once an hour.
const VALIDATE_EVERY: Duration = Duration::from_secs(60 * 60);

/// Whether this build knows about a shared Twitch application. Builds made without
/// the two values above fall back to the "use your own Twitch application" flow.
pub fn hosted_available() -> bool {
    !TWITCH_CLIENT_ID.is_empty() && !BROKER_BASE_URL.is_empty()
}

fn hosted_runtime(state: &AppRuntimeState) -> Result<PredictionRuntime, String> {
    let runtime = current_runtime(state)?;
    if runtime.hosted {
        Ok(runtime)
    } else {
        Err("You're using your own Twitch application. Use the regular Connect button instead."
            .into())
    }
}

/// Open the sign-in page in the user's default browser.
#[tauri::command]
pub fn start_hosted_login(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<(), String> {
    let runtime = hosted_runtime(&state)?;
    let url = runtime
        .twitch
        .hosted_login_url()
        .ok_or_else(|| "Hosted sign-in isn't available in this build.".to_string())?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("Could not open your browser: {error}"))?;
    push_log(
        &state.status,
        "info",
        "Opened the Twitch sign-in page. Copy the connection code, then come back and paste it.",
    );
    Ok(())
}

/// Read the connection code straight from the clipboard (Rust side only), redeem it,
/// and clear the clipboard if it still holds the code. Returns only the safe user.
#[tauri::command]
pub async fn import_connection_code_from_clipboard(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<SafeUser, String> {
    let text = app.clipboard().read_text().map_err(|_| {
        "Your clipboard is empty. Click Connect Twitch, then press Copy connection code on the page that opens."
            .to_string()
    })?;
    let user = redeem(&state, &text).await?;

    // Don't leave the code sitting in clipboard history longer than needed.
    if let Ok(current) = app.clipboard().read_text() {
        if current.trim() == text.trim() {
            let _ = app.clipboard().clear();
        }
    }
    Ok(user)
}

/// Fallback when the clipboard can't be read: the user pastes into a masked field.
#[tauri::command]
pub async fn import_connection_code(
    state: State<'_, AppRuntimeState>,
    code: String,
) -> Result<SafeUser, String> {
    redeem(&state, &code).await
}

async fn redeem(state: &AppRuntimeState, code: &str) -> Result<SafeUser, String> {
    let runtime = hosted_runtime(state)?;
    let user = connect::import_connection_code(&runtime.twitch, &state.db, code)
        .await
        .map_err(|error| error.to_string())?;
    push_log(
        &state.status,
        "success",
        &format!("Connected to Twitch as {}.", user.twitch_login),
    );
    Ok(user)
}

/// Validate the Twitch token at startup and then hourly. Only a definitive "Twitch
/// refused our refresh token" asks the user to reconnect; network errors just retry.
pub fn spawn_session_watchdog(
    predictions: Arc<RwLock<Option<PredictionRuntime>>>,
    db: Arc<Db>,
    status: Arc<Mutex<ValorantDetectionStatus>>,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        loop {
            check_once(&predictions, &db, &status).await;
            tokio::time::sleep(VALIDATE_EVERY).await;
        }
    });
}

async fn check_once(
    predictions: &Arc<RwLock<Option<PredictionRuntime>>>,
    db: &Arc<Db>,
    status: &Arc<Mutex<ValorantDetectionStatus>>,
) {
    let runtime = predictions.read().unwrap().clone();
    let Some(runtime) = runtime else { return };
    if db.get_user().ok().flatten().is_none() {
        return;
    }
    // The refresh token is already known to be dead; nothing to try until they reconnect.
    if runtime.service.reauth_required().unwrap_or(false) {
        return;
    }
    match runtime.service.check_session().await {
        Ok(SessionHealth::Valid) => {}
        Ok(SessionHealth::Refreshed) => push_log(status, "info", "Twitch connection refreshed."),
        Ok(SessionHealth::ReauthRequired) => push_log(
            status,
            "warn",
            "Your Twitch sign-in expired. Open ValorPredict and reconnect Twitch.",
        ),
        Err(error) => push_log(
            status,
            "warn",
            &format!("Couldn't check your Twitch connection ({error}). Will retry in an hour."),
        ),
    }
}
