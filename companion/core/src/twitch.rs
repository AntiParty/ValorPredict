//! Twitch OAuth + Helix client.
//!
//! A pure HTTP client (no DB coupling). Token freshness/refresh is handled by
//! the prediction service, which owns persistence. Base URLs are injectable so
//! tests can point at a mock server.

use chrono::{SecondsFormat, Utc};
use reqwest::RequestBuilder;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use thiserror::Error;
use url::Url;

const SCOPES: &str = "channel:manage:predictions channel:read:predictions";
const DEFAULT_ID_BASE: &str = "https://id.twitch.tv";
const DEFAULT_API_BASE: &str = "https://api.twitch.tv";

#[derive(Debug, Error)]
pub enum TwitchError {
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{label} error ({status}): {message}")]
    Api {
        label: String,
        status: u16,
        message: String,
    },
    #[error("{0}")]
    Empty(&'static str),
}

pub type Result<T> = std::result::Result<T, TwitchError>;

#[derive(Debug, Clone)]
pub struct TwitchConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub id_base_url: String,
    pub api_base_url: String,
}

impl TwitchConfig {
    pub fn new(client_id: String, client_secret: String, redirect_uri: String) -> Self {
        Self {
            client_id,
            client_secret,
            redirect_uri,
            id_base_url: DEFAULT_ID_BASE.to_string(),
            api_base_url: DEFAULT_API_BASE.to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TwitchUser {
    pub id: String,
    pub login: String,
    pub display_name: String,
    #[serde(default)]
    pub profile_image_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PredictionOutcome {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub channel_points: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Prediction {
    pub id: String,
    pub title: String,
    pub status: String,
    pub outcomes: Vec<PredictionOutcome>,
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    data: Vec<T>,
}

pub struct CreatePredictionInput {
    pub title: String,
    pub outcome_a: String,
    pub outcome_b: String,
    pub prediction_window: i64,
}

/// The Twitch operations the prediction service depends on. Implemented by the
/// real `TwitchClient`; faked in tests. Boxed via async-trait so it can be held
/// as `Arc<dyn TwitchApi>` in shared state.
#[async_trait::async_trait]
pub trait TwitchApi: Send + Sync {
    async fn refresh_token(&self, refresh_token: &str) -> Result<TokenResponse>;
    async fn create_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        input: &CreatePredictionInput,
    ) -> Result<Prediction>;
    async fn resolve_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        prediction_id: &str,
        winning_outcome_id: &str,
    ) -> Result<Prediction>;
    async fn cancel_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        prediction_id: &str,
    ) -> Result<()>;
}

#[async_trait::async_trait]
impl TwitchApi for TwitchClient {
    async fn refresh_token(&self, refresh_token: &str) -> Result<TokenResponse> {
        TwitchClient::refresh_token(self, refresh_token).await
    }
    async fn create_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        input: &CreatePredictionInput,
    ) -> Result<Prediction> {
        TwitchClient::create_prediction(self, access_token, broadcaster_id, input).await
    }
    async fn resolve_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        prediction_id: &str,
        winning_outcome_id: &str,
    ) -> Result<Prediction> {
        TwitchClient::resolve_prediction(
            self,
            access_token,
            broadcaster_id,
            prediction_id,
            winning_outcome_id,
        )
        .await
    }
    async fn cancel_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        prediction_id: &str,
    ) -> Result<()> {
        TwitchClient::cancel_prediction(self, access_token, broadcaster_id, prediction_id).await
    }
}

pub struct TwitchClient {
    config: TwitchConfig,
    http: reqwest::Client,
}

impl TwitchClient {
    pub fn new(config: TwitchConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    pub fn build_authorization_url(&self, state: &str) -> String {
        Url::parse_with_params(
            &format!("{}/oauth2/authorize", self.config.id_base_url),
            &[
                ("client_id", self.config.client_id.as_str()),
                ("redirect_uri", self.config.redirect_uri.as_str()),
                ("response_type", "code"),
                ("scope", SCOPES),
                ("state", state),
            ],
        )
        .expect("valid authorization url")
        .to_string()
    }

    pub async fn exchange_code(&self, code: &str) -> Result<TokenResponse> {
        let req = self
            .http
            .post(format!("{}/oauth2/token", self.config.id_base_url))
            .query(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("redirect_uri", self.config.redirect_uri.as_str()),
            ]);
        self.send_json("Twitch OAuth", req).await
    }

    pub async fn refresh_token(&self, refresh_token: &str) -> Result<TokenResponse> {
        let req = self
            .http
            .post(format!("{}/oauth2/token", self.config.id_base_url))
            .query(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ]);
        self.send_json("Twitch OAuth", req).await
    }

    pub async fn get_current_user(&self, access_token: &str) -> Result<TwitchUser> {
        let req = self.helix(
            access_token,
            self.http
                .get(format!("{}/helix/users", self.config.api_base_url)),
        );
        let envelope: Envelope<TwitchUser> = self.send_json("Twitch API", req).await?;
        envelope
            .data
            .into_iter()
            .next()
            .ok_or(TwitchError::Empty(
                "Twitch did not return a user for this token.",
            ))
    }

    pub async fn create_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        input: &CreatePredictionInput,
    ) -> Result<Prediction> {
        let body = serde_json::json!({
            "broadcaster_id": broadcaster_id,
            "title": input.title,
            "outcomes": [{ "title": input.outcome_a }, { "title": input.outcome_b }],
            "prediction_window": input.prediction_window,
        });
        let req = self
            .helix(
                access_token,
                self.http
                    .post(format!("{}/helix/predictions", self.config.api_base_url)),
            )
            .json(&body);
        let envelope: Envelope<Prediction> = self.send_json("Twitch API", req).await?;
        envelope
            .data
            .into_iter()
            .next()
            .ok_or(TwitchError::Empty("Twitch did not return the new prediction."))
    }

    pub async fn resolve_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        prediction_id: &str,
        winning_outcome_id: &str,
    ) -> Result<Prediction> {
        let body = serde_json::json!({
            "broadcaster_id": broadcaster_id,
            "id": prediction_id,
            "status": "RESOLVED",
            "winning_outcome_id": winning_outcome_id,
        });
        let req = self
            .helix(
                access_token,
                self.http
                    .patch(format!("{}/helix/predictions", self.config.api_base_url)),
            )
            .json(&body);
        let envelope: Envelope<Prediction> = self.send_json("Twitch API", req).await?;
        envelope
            .data
            .into_iter()
            .next()
            .ok_or(TwitchError::Empty(
                "Twitch did not return the resolved prediction.",
            ))
    }

    pub async fn cancel_prediction(
        &self,
        access_token: &str,
        broadcaster_id: &str,
        prediction_id: &str,
    ) -> Result<()> {
        let body = serde_json::json!({
            "broadcaster_id": broadcaster_id,
            "id": prediction_id,
            "status": "CANCELED",
        });
        let req = self
            .helix(
                access_token,
                self.http
                    .patch(format!("{}/helix/predictions", self.config.api_base_url)),
            )
            .json(&body);
        let _: serde_json::Value = self.send_json("Twitch API", req).await?;
        Ok(())
    }

    pub fn token_expires_at(expires_in_seconds: i64) -> String {
        (Utc::now() + chrono::Duration::seconds(expires_in_seconds))
            .to_rfc3339_opts(SecondsFormat::Millis, true)
    }

    fn helix(&self, access_token: &str, req: RequestBuilder) -> RequestBuilder {
        req.header("Client-Id", &self.config.client_id)
            .bearer_auth(access_token)
    }

    async fn send_json<T: DeserializeOwned>(
        &self,
        label: &str,
        req: RequestBuilder,
    ) -> Result<T> {
        let response = req.send().await?;
        let status = response.status();
        let text = response.text().await?;

        if !status.is_success() {
            let message = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|body| {
                    body.get("message")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned)
                })
                .filter(|message| !message.is_empty())
                .unwrap_or_else(|| {
                    status
                        .canonical_reason()
                        .unwrap_or("Unknown error")
                        .to_string()
                });
            return Err(TwitchError::Api {
                label: label.to_string(),
                status: status.as_u16(),
                message,
            });
        }

        serde_json::from_str::<T>(&text).map_err(|error| TwitchError::Api {
            label: label.to_string(),
            status: status.as_u16(),
            message: format!("invalid JSON: {error}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use httpmock::Method::PATCH;
    use serde_json::json;

    fn client_for(server: &MockServer) -> TwitchClient {
        let mut config = TwitchConfig::new(
            "client-id".into(),
            "client-secret".into(),
            "http://localhost:3000/auth/twitch/callback".into(),
        );
        config.id_base_url = server.base_url();
        config.api_base_url = server.base_url();
        TwitchClient::new(config)
    }

    #[test]
    fn authorization_url_carries_client_and_scopes() {
        let config = TwitchConfig::new(
            "abc".into(),
            "secret".into(),
            "http://localhost:3000/auth/twitch/callback".into(),
        );
        let url = TwitchClient::new(config).build_authorization_url("state-123");
        assert!(url.starts_with("https://id.twitch.tv/oauth2/authorize?"));
        assert!(url.contains("client_id=abc"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("channel%3Amanage%3Apredictions"));
        assert!(url.contains("state=state-123"));
        // The secret must never appear in the user-facing authorize URL.
        assert!(!url.contains("secret"));
    }

    #[tokio::test]
    async fn exchanges_code_for_tokens() {
        let server = MockServer::start_async().await;
        let mock = server
            .mock_async(|when, then| {
                when.method(POST)
                    .path("/oauth2/token")
                    .query_param("grant_type", "authorization_code")
                    .query_param("code", "oauth-code");
                then.status(200).json_body(json!({
                    "access_token": "access-1",
                    "refresh_token": "refresh-1",
                    "expires_in": 3600
                }));
            })
            .await;

        let token = client_for(&server)
            .exchange_code("oauth-code")
            .await
            .unwrap();

        mock.assert_async().await;
        assert_eq!(token.access_token, "access-1");
        assert_eq!(token.refresh_token.as_deref(), Some("refresh-1"));
        assert_eq!(token.expires_in, 3600);
    }

    #[tokio::test]
    async fn gets_current_user_or_errors_when_empty() {
        let server = MockServer::start_async().await;
        let present = server
            .mock_async(|when, then| {
                when.method(GET)
                    .path("/helix/users")
                    .header("Client-Id", "client-id")
                    .header("Authorization", "Bearer access-1");
                then.status(200).json_body(json!({
                    "data": [{
                        "id": "123", "login": "ace",
                        "display_name": "Ace", "profile_image_url": "https://x/ace.png"
                    }]
                }));
            })
            .await;

        let user = client_for(&server)
            .get_current_user("access-1")
            .await
            .unwrap();
        present.assert_async().await;
        assert_eq!(user.id, "123");
        assert_eq!(user.login, "ace");

        let empty_server = MockServer::start_async().await;
        empty_server
            .mock_async(|when, then| {
                when.method(GET).path("/helix/users");
                then.status(200).json_body(json!({ "data": [] }));
            })
            .await;
        let err = client_for(&empty_server)
            .get_current_user("access-1")
            .await
            .unwrap_err();
        assert!(matches!(err, TwitchError::Empty(_)));
    }

    #[tokio::test]
    async fn creates_prediction_with_expected_body() {
        let server = MockServer::start_async().await;
        let mock = server
            .mock_async(|when, then| {
                when.method(POST)
                    .path("/helix/predictions")
                    .header("Client-Id", "client-id")
                    .json_body(json!({
                        "broadcaster_id": "123",
                        "title": "Will ace win?",
                        "outcomes": [{ "title": "Yes" }, { "title": "No" }],
                        "prediction_window": 120
                    }));
                then.status(200).json_body(json!({
                    "data": [{
                        "id": "pred-1", "title": "Will ace win?", "status": "ACTIVE",
                        "outcomes": [
                            { "id": "a", "title": "Yes" },
                            { "id": "b", "title": "No" }
                        ]
                    }]
                }));
            })
            .await;

        let prediction = client_for(&server)
            .create_prediction(
                "access-1",
                "123",
                &CreatePredictionInput {
                    title: "Will ace win?".into(),
                    outcome_a: "Yes".into(),
                    outcome_b: "No".into(),
                    prediction_window: 120,
                },
            )
            .await
            .unwrap();

        mock.assert_async().await;
        assert_eq!(prediction.id, "pred-1");
        assert_eq!(prediction.outcomes.len(), 2);
        assert_eq!(prediction.outcomes[0].id, "a");
    }

    #[tokio::test]
    async fn resolves_and_cancels_prediction() {
        let server = MockServer::start_async().await;
        let resolve = server
            .mock_async(|when, then| {
                when.method(PATCH).path("/helix/predictions").json_body(json!({
                    "broadcaster_id": "123",
                    "id": "pred-1",
                    "status": "RESOLVED",
                    "winning_outcome_id": "a"
                }));
                then.status(200).json_body(json!({
                    "data": [{
                        "id": "pred-1", "title": "t", "status": "RESOLVED",
                        "outcomes": [
                            { "id": "a", "title": "Yes", "channel_points": 1250 },
                            { "id": "b", "title": "No", "channel_points": 750 }
                        ]
                    }]
                }));
            })
            .await;

        let resolved = client_for(&server)
            .resolve_prediction("access-1", "123", "pred-1", "a")
            .await
            .unwrap();
        resolve.assert_async().await;
        assert_eq!(resolved.status, "RESOLVED");
        assert_eq!(resolved.outcomes[0].channel_points, 1250);

        let cancel_server = MockServer::start_async().await;
        let cancel = cancel_server
            .mock_async(|when, then| {
                when.method(PATCH).path("/helix/predictions").json_body(json!({
                    "broadcaster_id": "123",
                    "id": "pred-1",
                    "status": "CANCELED"
                }));
                then.status(200).json_body(json!({ "data": [] }));
            })
            .await;
        client_for(&cancel_server)
            .cancel_prediction("access-1", "123", "pred-1")
            .await
            .unwrap();
        cancel.assert_async().await;
    }

    #[tokio::test]
    async fn surfaces_twitch_error_message() {
        let server = MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(POST).path("/helix/predictions");
                then.status(400)
                    .json_body(json!({ "message": "channel points not enabled" }));
            })
            .await;

        let err = client_for(&server)
            .create_prediction(
                "access-1",
                "123",
                &CreatePredictionInput {
                    title: "t".into(),
                    outcome_a: "Yes".into(),
                    outcome_b: "No".into(),
                    prediction_window: 90,
                },
            )
            .await
            .unwrap_err();

        match err {
            TwitchError::Api { status, message, .. } => {
                assert_eq!(status, 400);
                assert!(message.contains("channel points not enabled"));
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }
}
