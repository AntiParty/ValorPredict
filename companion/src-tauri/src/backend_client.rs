use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::json;

use crate::models::{AppSettings, BackendEventPayload, BackendResponse, ValorantLocalState};
use crate::riot_local_client::DuoParty;

#[derive(Debug, Clone, PartialEq)]
pub struct PingOutcome {
    pub ok: bool,
    pub duo_enabled: bool,
    pub message: String,
}

#[derive(Clone)]
pub struct BackendClient {
    client: Client,
}

impl Default for BackendClient {
    fn default() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .build()
                .expect("valid HTTP client"),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PingResponse {
    ok: bool,
    twitch_login: String,
    #[serde(default)]
    duo_enabled: bool,
}

#[derive(Deserialize)]
struct ApiResponse {
    ok: bool,
    action: String,
    message: String,
}

#[derive(Deserialize)]
struct DuoUploadResponse {
    ok: bool,
    action: String,
    #[serde(default)]
    accepted: u32,
    #[serde(default)]
    message: String,
}

impl BackendClient {
    pub async fn ping(&self, settings: &AppSettings) -> Result<PingOutcome, String> {
        validate_settings(settings)?;
        let response = self
            .client
            .get(endpoint(&settings.backend_url, "/api/local/ping"))
            .bearer_auth(&settings.local_api_key)
            .send()
            .await
            .map_err(|error| network_error("Backend ping failed", error))?;
        let status = response.status();
        if !status.is_success() {
            return Err(response_error("Backend ping", status, response).await);
        }
        let body: PingResponse = response
            .json()
            .await
            .map_err(|_| "Backend ping returned invalid JSON.".to_string())?;
        Ok(PingOutcome {
            ok: body.ok,
            duo_enabled: body.duo_enabled,
            message: format!("Connected as {}.", body.twitch_login),
        })
    }

    pub async fn upload_duo(
        &self,
        settings: &AppSettings,
        party: &DuoParty,
    ) -> Result<BackendResponse, String> {
        validate_settings(settings)?;
        let response = self
            .client
            .post(endpoint(&settings.backend_url, "/api/local/duo"))
            .bearer_auth(&settings.local_api_key)
            .json(party)
            .send()
            .await
            .map_err(|error| network_error("Duo upload failed", error))?;
        let status = response.status();
        if !status.is_success() {
            return Err(response_error("Duo upload", status, response).await);
        }
        let body: DuoUploadResponse = response
            .json()
            .await
            .map_err(|_| "Duo upload returned invalid JSON.".to_string())?;
        let message = if body.message.is_empty() {
            format!("Published {} duo member(s).", body.accepted)
        } else {
            body.message
        };
        Ok(BackendResponse {
            ok: body.ok,
            action: body.action,
            message,
        })
    }

    pub async fn send_state(
        &self,
        settings: &AppSettings,
        payload: &BackendEventPayload,
    ) -> Result<BackendResponse, String> {
        validate_settings(settings)?;
        let response = self
            .client
            .post(endpoint(&settings.backend_url, "/api/local/valorant-state"))
            .bearer_auth(&settings.local_api_key)
            .json(payload)
            .send()
            .await
            .map_err(|error| network_error("State update failed", error))?;

        if response.status() == StatusCode::NOT_FOUND
            && payload.state == ValorantLocalState::CurrentGame
        {
            return self.send_match_start_fallback(settings, payload).await;
        }
        parse_api_response("State update", response).await
    }

    async fn send_match_start_fallback(
        &self,
        settings: &AppSettings,
        payload: &BackendEventPayload,
    ) -> Result<BackendResponse, String> {
        let response = self
            .client
            .post(endpoint(
                &settings.backend_url,
                "/api/local/valorant-match-start",
            ))
            .bearer_auth(&settings.local_api_key)
            .json(&json!({
                "gameMode": payload.game_mode,
                "source": "local_companion",
                "event": "match_start",
                "confidence": payload.confidence,
                "details": {
                    "detectionMethod": payload.details.detection_method,
                    "state": "current_game",
                    "matchIdHash": payload.match_id_hash,
                    "region": payload.details.region,
                    "shard": payload.details.shard
                }
            }))
            .send()
            .await
            .map_err(|error| network_error("Match-start fallback failed", error))?;
        parse_api_response("Match-start fallback", response).await
    }
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if !(settings.backend_url.starts_with("http://")
        || settings.backend_url.starts_with("https://"))
    {
        return Err("Backend URL must start with http:// or https://.".into());
    }
    if settings.local_api_key.trim().is_empty() {
        return Err("A local API key is required.".into());
    }
    Ok(())
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

async fn parse_api_response(
    label: &str,
    response: reqwest::Response,
) -> Result<BackendResponse, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(response_error(label, status, response).await);
    }
    let body: ApiResponse = response
        .json()
        .await
        .map_err(|_| format!("{label} returned invalid JSON."))?;
    Ok(BackendResponse {
        ok: body.ok,
        action: body.action,
        message: body.message,
    })
}

async fn response_error(label: &str, status: StatusCode, response: reqwest::Response) -> String {
    let message = response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|body| {
            body.get("message")
                .or_else(|| body.get("error"))
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "Unknown backend error.".into());
    format!("{label} failed ({status}): {message}")
}

fn network_error(label: &str, error: reqwest::Error) -> String {
    if error.is_timeout() {
        format!("{label}: request timed out.")
    } else if error.is_connect() {
        format!("{label}: could not connect to backend.")
    } else {
        format!("{label}: network request failed.")
    }
}
