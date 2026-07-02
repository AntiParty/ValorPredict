//! Axum HTTP server: the `/api/*` JSON contract the React dashboard consumes,
//! the Twitch OAuth routes, and (in the desktop app) the built SPA.
//!
//! Single-user/local, so "logged in" simply means a user row exists; the OAuth
//! `state` is held in memory (one flow at a time). Twitch credentials are
//! supplied at runtime via the Settings screen, so the client + prediction
//! service live behind an `RwLock` and are (re)built when credentials are saved.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};

use crate::db::{Db, PresetInput, SafeUser};
use crate::predictions::{PredictionService, ServiceError, Winner};
use crate::twitch::{TwitchClient, TwitchConfig};

/// The Twitch-dependent services, present only once credentials are configured.
#[derive(Clone)]
pub struct Runtime {
    pub twitch: Arc<TwitchClient>,
    pub service: Arc<PredictionService>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub redirect_uri: String,
    pub development_mode: bool,
    pub static_dir: Option<PathBuf>,
    pub pending_state: Arc<Mutex<Option<String>>>,
    pub runtime: Arc<RwLock<Option<Runtime>>>,
}

impl AppState {
    /// Build state, restoring the Twitch runtime if credentials were saved.
    pub fn new(
        db: Arc<Db>,
        redirect_uri: String,
        development_mode: bool,
        static_dir: Option<PathBuf>,
    ) -> Self {
        let runtime = db
            .get_twitch_credentials()
            .ok()
            .flatten()
            .map(|(id, secret)| build_runtime(db.clone(), id, secret, &redirect_uri));
        Self {
            db,
            redirect_uri,
            development_mode,
            static_dir,
            pending_state: Arc::new(Mutex::new(None)),
            runtime: Arc::new(RwLock::new(runtime)),
        }
    }

    fn runtime(&self) -> Option<Runtime> {
        self.runtime.read().unwrap().clone()
    }

    fn is_configured(&self) -> bool {
        self.runtime.read().unwrap().is_some()
    }
}

pub fn build_runtime(
    db: Arc<Db>,
    client_id: String,
    client_secret: String,
    redirect_uri: &str,
) -> Runtime {
    let config = TwitchConfig::new(client_id, client_secret, redirect_uri.to_string());
    let twitch = Arc::new(TwitchClient::new(config));
    let service = Arc::new(PredictionService::new(db, twitch.clone()));
    Runtime { twitch, service }
}

pub fn build_router(state: AppState) -> Router {
    let mut router = Router::new()
        .route("/api/me", get(get_me))
        .route("/api/dashboard", get(get_dashboard))
        .route("/api/settings/twitch", get(get_twitch_settings).post(post_twitch_settings))
        .route("/api/presets/{game_mode}", post(post_preset))
        .route("/api/predictions/resolve", post(post_resolve))
        .route("/api/predictions/cancel", post(post_cancel))
        .route("/auth/twitch", get(auth_twitch))
        .route("/auth/twitch/callback", get(auth_callback));

    if state.development_mode {
        router = router.route(
            "/api/predictions/simulate-match-start/{game_mode}",
            post(post_simulate),
        );
    }

    // Serve the built SPA for everything else; deep links fall back to index.html.
    if let Some(dir) = state.static_dir.clone() {
        let index = dir.join("index.html");
        router = router.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
    }

    router.with_state(state)
}

// ---- read endpoints -------------------------------------------------------

async fn get_me(State(state): State<AppState>) -> Response {
    let user = state.db.get_user().ok().flatten();
    Json(json!({
        "user": user,
        "flash": null,
        "configured": state.is_configured(),
    }))
    .into_response()
}

async fn get_dashboard(State(state): State<AppState>) -> Response {
    let Some(user) = state.db.get_user().ok().flatten() else {
        return unauthorized();
    };
    let presets = state
        .db
        .ensure_default_presets(&user.twitch_user_id)
        .unwrap_or_default();
    let active = state
        .db
        .get_active_session(&user.twitch_user_id)
        .ok()
        .flatten();
    let events = state
        .db
        .get_recent_events(&user.twitch_user_id, 5)
        .unwrap_or_default();

    Json(json!({
        "user": user,
        "presets": presets,
        "activeSession": active,
        "events": events,
        "developmentMode": state.development_mode,
    }))
    .into_response()
}

async fn get_twitch_settings(State(state): State<AppState>) -> Response {
    Json(json!({ "configured": state.is_configured() })).into_response()
}

// ---- settings -------------------------------------------------------------

#[derive(Deserialize)]
struct TwitchCredentialsBody {
    #[serde(rename = "clientId")]
    client_id: String,
    #[serde(rename = "clientSecret")]
    client_secret: String,
}

async fn post_twitch_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TwitchCredentialsBody>,
) -> Response {
    if let Err(response) = require_fetch(&headers) {
        return response;
    }
    let client_id = body.client_id.trim().to_string();
    let client_secret = body.client_secret.trim().to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return bad_request("Client ID and secret are required.");
    }
    if state
        .db
        .save_twitch_credentials(&client_id, &client_secret)
        .is_err()
    {
        return bad_request("Could not save credentials.");
    }
    let runtime = build_runtime(state.db.clone(), client_id, client_secret, &state.redirect_uri);
    *state.runtime.write().unwrap() = Some(runtime);
    Json(json!({ "ok": true, "configured": true })).into_response()
}

// ---- mutations ------------------------------------------------------------

#[derive(Deserialize)]
struct PresetBody {
    enabled: bool,
    #[serde(rename = "titleTemplate")]
    title_template: String,
    #[serde(rename = "outcomeA")]
    outcome_a: String,
    #[serde(rename = "outcomeB")]
    outcome_b: String,
    #[serde(rename = "predictionWindow")]
    prediction_window: i64,
}

async fn post_preset(
    State(state): State<AppState>,
    Path(game_mode): Path<String>,
    headers: HeaderMap,
    Json(body): Json<PresetBody>,
) -> Response {
    if let Err(response) = require_fetch(&headers) {
        return response;
    }
    let user = match current_user(&state) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if game_mode != "competitive" && game_mode != "custom" {
        return bad_request("Unsupported game mode.");
    }
    let input = match validate_preset(body) {
        Ok(input) => input,
        Err(message) => return bad_request(&message),
    };
    match state.db.save_preset(&user.twitch_user_id, &game_mode, input) {
        Ok(preset) => Json(json!({ "ok": true, "preset": preset })).into_response(),
        Err(_) => bad_request("Could not save preset."),
    }
}

#[derive(Deserialize)]
struct ResolveBody {
    winner: String,
}

async fn post_resolve(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ResolveBody>,
) -> Response {
    if let Err(response) = require_fetch(&headers) {
        return response;
    }
    let Some(user) = state.db.get_user().ok().flatten() else {
        return unauthorized();
    };
    let Some(runtime) = state.runtime() else {
        return bad_request("Twitch is not configured.");
    };
    let winner = match body.winner.as_str() {
        "A" => Winner::A,
        "B" => Winner::B,
        _ => return bad_request("Winner must be A or B."),
    };
    match runtime.service.resolve(&user.twitch_user_id, winner).await {
        Ok(_) => Json(json!({ "ok": true, "message": "Prediction resolved." })).into_response(),
        Err(error) => service_error(error),
    }
}

async fn post_cancel(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_fetch(&headers) {
        return response;
    }
    let Some(user) = state.db.get_user().ok().flatten() else {
        return unauthorized();
    };
    let Some(runtime) = state.runtime() else {
        return bad_request("Twitch is not configured.");
    };
    match runtime.service.cancel(&user.twitch_user_id).await {
        Ok(_) => Json(json!({ "ok": true, "message": "Prediction cancelled." })).into_response(),
        Err(error) => service_error(error),
    }
}

async fn post_simulate(
    State(state): State<AppState>,
    Path(game_mode): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = require_fetch(&headers) {
        return response;
    }
    let Some(user) = state.db.get_user().ok().flatten() else {
        return unauthorized();
    };
    let Some(runtime) = state.runtime() else {
        return bad_request("Twitch is not configured.");
    };
    match runtime
        .service
        .handle_match_start(&user.twitch_user_id, "manual", &game_mode)
        .await
    {
        Ok(result) => Json(json!({
            "ok": true,
            "action": result.action,
            "message": result.message,
        }))
        .into_response(),
        Err(error) => service_error(error),
    }
}

// ---- auth -----------------------------------------------------------------

async fn auth_twitch(State(state): State<AppState>) -> Response {
    let Some(runtime) = state.runtime() else {
        // Not configured yet — send the user back to the SPA (Settings screen).
        return Redirect::to("/").into_response();
    };
    let oauth_state = uuid::Uuid::new_v4().to_string();
    *state.pending_state.lock().unwrap() = Some(oauth_state.clone());
    Redirect::to(&runtime.twitch.build_authorization_url(&oauth_state)).into_response()
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

async fn auth_callback(
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let Some(runtime) = state.runtime() else {
        return Redirect::to("/").into_response();
    };
    let expected = state.pending_state.lock().unwrap().take();
    let (Some(code), Some(returned_state), Some(expected)) = (query.code, query.state, expected)
    else {
        return Redirect::to("/").into_response();
    };
    if returned_state != expected {
        return Redirect::to("/").into_response();
    }

    let token = match runtime.twitch.exchange_code(&code).await {
        Ok(token) => token,
        Err(_) => return Redirect::to("/").into_response(),
    };
    let profile = match runtime.twitch.get_current_user(&token.access_token).await {
        Ok(profile) => profile,
        Err(_) => return Redirect::to("/").into_response(),
    };

    let upsert = crate::db::UpsertUser {
        twitch_user_id: profile.id,
        twitch_login: profile.login,
        twitch_display_name: profile.display_name,
        twitch_profile_image_url: profile.profile_image_url,
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_default(),
        token_expires_at: TwitchClient::token_expires_at(token.expires_in),
    };
    if state.db.upsert_user(upsert).is_err() {
        return Redirect::to("/").into_response();
    }
    Redirect::to("/dashboard").into_response()
}

// ---- helpers --------------------------------------------------------------

fn require_fetch(headers: &HeaderMap) -> Result<(), Response> {
    if headers.get("x-requested-with").is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "Missing X-Requested-With header." })),
        )
            .into_response());
    }
    Ok(())
}

fn current_user(state: &AppState) -> Result<SafeUser, Response> {
    state.db.get_user().ok().flatten().ok_or_else(unauthorized)
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "ok": false, "error": "Login required." })),
    )
        .into_response()
}

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "ok": false, "error": message })),
    )
        .into_response()
}

fn service_error(error: ServiceError) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "ok": false, "error": error.to_string() })),
    )
        .into_response()
}

fn validate_preset(body: PresetBody) -> std::result::Result<PresetInput, String> {
    let title = body.title_template.trim().to_string();
    if title.is_empty() || title.chars().count() > 45 {
        return Err("Prediction title must be between 1 and 45 characters.".into());
    }
    let outcome_a = body.outcome_a.trim().to_string();
    let outcome_b = body.outcome_b.trim().to_string();
    if outcome_a.is_empty()
        || outcome_b.is_empty()
        || outcome_a.chars().count() > 25
        || outcome_b.chars().count() > 25
    {
        return Err("Each outcome must be between 1 and 25 characters.".into());
    }
    Ok(PresetInput {
        enabled: body.enabled,
        title_template: title,
        outcome_a,
        outcome_b,
        prediction_window: body.prediction_window.clamp(30, 1800),
        // The legacy web server doesn't manage auto-resolution; default the
        // winning outcome to A so the shared type stays satisfied.
        win_outcome: "A".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::twitch::TwitchConfig;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use httpmock::prelude::*;
    use serde_json::Value;
    use tower::ServiceExt;

    fn redirect_uri() -> String {
        "http://localhost:3000/auth/twitch/callback".into()
    }

    /// State whose Twitch runtime points at the mock server.
    fn state_with(server: &MockServer, development_mode: bool) -> AppState {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let state = AppState::new(db.clone(), redirect_uri(), development_mode, None);
        let mut config =
            TwitchConfig::new("client-id".into(), "client-secret".into(), redirect_uri());
        config.id_base_url = server.base_url();
        config.api_base_url = server.base_url();
        let twitch = Arc::new(TwitchClient::new(config));
        let service = Arc::new(PredictionService::new(db, twitch.clone()));
        *state.runtime.write().unwrap() = Some(Runtime { twitch, service });
        state
    }

    async fn body_json(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        if bytes.is_empty() {
            return Value::Null;
        }
        serde_json::from_slice(&bytes).unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    fn post_json(uri: &str, with_header: bool, body: Value) -> Request<Body> {
        let mut builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json");
        if with_header {
            builder = builder.header("x-requested-with", "fetch");
        }
        builder.body(Body::from(body.to_string())).unwrap()
    }

    async fn mock_twitch(server: &MockServer) {
        server
            .mock_async(|when, then| {
                when.method(POST).path("/oauth2/token");
                then.status(200).json_body(json!({
                    "access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3600
                }));
            })
            .await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/helix/users");
                then.status(200).json_body(json!({
                    "data": [{ "id": "123", "login": "ace", "display_name": "Ace Player",
                               "profile_image_url": null }]
                }));
            })
            .await;
    }

    async fn connect(app: &Router, server: &MockServer) {
        mock_twitch(server).await;
        let start = app.clone().oneshot(get("/auth/twitch")).await.unwrap();
        let location = start.headers().get("location").unwrap().to_str().unwrap();
        let state_value = url::Url::parse(location)
            .unwrap()
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        app.clone()
            .oneshot(get(&format!(
                "/auth/twitch/callback?code=c&state={state_value}"
            )))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn me_reports_unconfigured_and_logged_out() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let state = AppState::new(db, redirect_uri(), false, None);
        let app = build_router(state);
        let body = body_json(app.oneshot(get("/api/me")).await.unwrap()).await;
        assert_eq!(body["user"], Value::Null);
        assert_eq!(body["configured"], false);
    }

    #[tokio::test]
    async fn saving_credentials_marks_configured_and_persists() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let state = AppState::new(db.clone(), redirect_uri(), false, None);
        let app = build_router(state);

        let res = app
            .clone()
            .oneshot(post_json(
                "/api/settings/twitch",
                true,
                json!({ "clientId": "abc", "clientSecret": "xyz" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let me = body_json(app.oneshot(get("/api/me")).await.unwrap()).await;
        assert_eq!(me["configured"], true);
        assert_eq!(
            db.get_twitch_credentials().unwrap().unwrap(),
            ("abc".to_string(), "xyz".to_string())
        );
    }

    #[tokio::test]
    async fn credentials_require_both_fields() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let app = build_router(AppState::new(db, redirect_uri(), false, None));
        let res = app
            .oneshot(post_json(
                "/api/settings/twitch",
                true,
                json!({ "clientId": "abc", "clientSecret": "  " }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn dashboard_requires_login() {
        let server = MockServer::start_async().await;
        let app = build_router(state_with(&server, false));
        let res = app.oneshot(get("/api/dashboard")).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn oauth_callback_connects_user() {
        let server = MockServer::start_async().await;
        let app = build_router(state_with(&server, true));
        connect(&app, &server).await;

        let me = body_json(app.clone().oneshot(get("/api/me")).await.unwrap()).await;
        assert_eq!(me["user"]["twitch_login"], "ace");
        assert!(!me.to_string().contains("access-1"));

        let dashboard = body_json(app.oneshot(get("/api/dashboard")).await.unwrap()).await;
        assert_eq!(dashboard["presets"].as_array().unwrap().len(), 2);
        assert_eq!(dashboard["developmentMode"], true);
    }

    #[tokio::test]
    async fn oauth_callback_rejects_bad_state() {
        let server = MockServer::start_async().await;
        let app = build_router(state_with(&server, false));
        let res = app
            .oneshot(get("/auth/twitch/callback?code=x&state=wrong"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::SEE_OTHER);
        assert_eq!(res.headers().get("location").unwrap().to_str().unwrap(), "/");
    }

    #[tokio::test]
    async fn preset_save_requires_csrf_header_and_validates() {
        let server = MockServer::start_async().await;
        let app = build_router(state_with(&server, false));
        connect(&app, &server).await;

        let forbidden = app
            .clone()
            .oneshot(post_json(
                "/api/presets/competitive",
                false,
                json!({ "enabled": true, "titleTemplate": "t", "outcomeA": "Yes",
                        "outcomeB": "No", "predictionWindow": 120 }),
            ))
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let invalid = app
            .clone()
            .oneshot(post_json(
                "/api/presets/competitive",
                true,
                json!({ "enabled": true, "titleTemplate": "x".repeat(46), "outcomeA": "Yes",
                        "outcomeB": "No", "predictionWindow": 120 }),
            ))
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let ok = app
            .oneshot(post_json(
                "/api/presets/competitive",
                true,
                json!({ "enabled": true, "titleTemplate": "Will {streamer} win?",
                        "outcomeA": "Yes", "outcomeB": "No", "predictionWindow": 5000 }),
            ))
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let body = body_json(ok).await;
        assert_eq!(body["preset"]["enabled"], 1);
        assert_eq!(body["preset"]["prediction_window"], 1800);
    }

    #[tokio::test]
    async fn resolve_without_open_prediction_is_400() {
        let server = MockServer::start_async().await;
        let app = build_router(state_with(&server, false));
        connect(&app, &server).await;

        let res = app
            .oneshot(post_json(
                "/api/predictions/resolve",
                true,
                json!({ "winner": "A" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let body = body_json(res).await;
        assert!(body["error"].as_str().unwrap().contains("no open prediction"));
    }

    #[tokio::test]
    async fn simulate_route_absent_in_production() {
        let server = MockServer::start_async().await;
        let app = build_router(state_with(&server, false));
        connect(&app, &server).await;
        let res = app
            .oneshot(post_json(
                "/api/predictions/simulate-match-start/competitive",
                true,
                json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}
