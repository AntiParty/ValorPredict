//! Prediction lifecycle: turn a detected match start into a Twitch prediction,
//! then resolve or cancel it. Ported from the Node `PredictionService`, with the
//! token-freshness/refresh logic folded in here (it owns the DB).

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use thiserror::Error;

use crate::db::{Db, DbError, PredictionSession, SessionUpdate};
use crate::twitch::{CreatePredictionInput, TwitchApi, TwitchClient, TwitchError};

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Twitch(#[from] TwitchError),
}

pub type Result<T> = std::result::Result<T, ServiceError>;

#[derive(Debug, Clone, Copy)]
pub enum Winner {
    A,
    B,
}

#[derive(Debug, Serialize)]
pub struct MatchStartResult {
    pub action: &'static str,
    pub message: String,
    pub session: Option<PredictionSession>,
}

pub struct PredictionService {
    db: Arc<Db>,
    twitch: Arc<dyn TwitchApi>,
}

impl PredictionService {
    pub fn new(db: Arc<Db>, twitch: Arc<dyn TwitchApi>) -> Self {
        Self { db, twitch }
    }

    pub async fn handle_match_start(
        &self,
        twitch_user_id: &str,
        source: &str,
        game_mode: &str,
    ) -> Result<MatchStartResult> {
        let user = self
            .db
            .get_user_by_twitch_id(twitch_user_id)?
            .ok_or_else(|| ServiceError::Message("Twitch user is not connected.".into()))?;

        self.db.ensure_default_presets(twitch_user_id)?;

        let preset = if game_mode == "competitive" || game_mode == "custom" {
            self.db.get_preset(twitch_user_id, game_mode)?
        } else {
            None
        };
        let preset = match preset {
            Some(preset) if preset.enabled != 0 => preset,
            _ => {
                return Ok(MatchStartResult {
                    action: "ignored",
                    message: "No enabled preset exists for this game mode.".into(),
                    session: None,
                })
            }
        };

        if self.db.get_active_session(twitch_user_id)?.is_some() {
            return Ok(MatchStartResult {
                action: "ignored",
                message: "A prediction is already active.".into(),
                session: None,
            });
        }

        let title = preset.title_template.replace("{streamer}", &user.twitch_login);
        let session = self
            .db
            .create_session(twitch_user_id, &title)
            .map_err(|_| ServiceError::Message("A prediction is already active.".into()))?;

        let access_token = self.fresh_access_token(twitch_user_id).await?;
        let input = CreatePredictionInput {
            title: title.clone(),
            outcome_a: preset.outcome_a.clone(),
            outcome_b: preset.outcome_b.clone(),
            prediction_window: preset.prediction_window.clamp(30, 1800),
        };

        let prediction = match self
            .twitch
            .create_prediction(&access_token, twitch_user_id, &input)
            .await
        {
            Ok(prediction) => prediction,
            Err(error) => {
                self.mark_failed(twitch_user_id, session.id, &error.to_string())?;
                return Err(ServiceError::Twitch(error));
            }
        };

        let outcome_a = prediction
            .outcomes
            .iter()
            .find(|outcome| outcome.title == preset.outcome_a)
            .or_else(|| prediction.outcomes.first())
            .cloned();
        let outcome_b = prediction
            .outcomes
            .iter()
            .find(|outcome| outcome.title == preset.outcome_b)
            .or_else(|| prediction.outcomes.get(1))
            .cloned();
        let (outcome_a, outcome_b) = match (outcome_a, outcome_b) {
            (Some(a), Some(b)) => (a, b),
            _ => {
                let message = "Twitch returned an invalid prediction outcome list.".to_string();
                self.mark_failed(twitch_user_id, session.id, &message)?;
                return Err(ServiceError::Message(message));
            }
        };

        let opened = self.db.update_session(
            session.id,
            SessionUpdate {
                status: "prediction_open".into(),
                twitch_prediction_id: Some(prediction.id),
                outcome_a_id: Some(outcome_a.id),
                outcome_b_id: Some(outcome_b.id),
                started_at: Some(now()),
                ..Default::default()
            },
        )?;
        self.db.add_event(
            twitch_user_id,
            Some(session.id),
            "prediction_created",
            &format!("Prediction opened from {source} for {game_mode}: {title}"),
        )?;

        Ok(MatchStartResult {
            action: "prediction_created",
            message: "Twitch prediction created.".into(),
            session: Some(opened),
        })
    }

    pub async fn resolve(&self, twitch_user_id: &str, winner: Winner) -> Result<PredictionSession> {
        self.require_user(twitch_user_id)?;
        let session = self.require_open_session(twitch_user_id)?;

        let outcome_id = match winner {
            Winner::A => session.outcome_a_id.clone(),
            Winner::B => session.outcome_b_id.clone(),
        };
        let (outcome_id, prediction_id) = match (outcome_id, session.twitch_prediction_id.clone()) {
            (Some(outcome_id), Some(prediction_id)) => (outcome_id, prediction_id),
            _ => {
                return Err(ServiceError::Message(
                    "The active prediction is missing Twitch identifiers.".into(),
                ))
            }
        };

        let access_token = self.fresh_access_token(twitch_user_id).await?;
        let twitch_prediction = match self
            .twitch
            .resolve_prediction(&access_token, twitch_user_id, &prediction_id, &outcome_id)
            .await
        {
            Ok(prediction) => prediction,
            Err(error) => {
                self.log_action_error(twitch_user_id, session.id, &error.to_string())?;
                return Err(ServiceError::Twitch(error));
            }
        };

        let channel_points: i64 = twitch_prediction
            .outcomes
            .iter()
            .map(|outcome| outcome.channel_points)
            .sum();
        let result = match winner {
            Winner::A => "outcome_a",
            Winner::B => "outcome_b",
        };

        let resolved = self.db.update_session(
            session.id,
            SessionUpdate {
                status: "resolved".into(),
                resolved_at: Some(now()),
                result: Some(result.into()),
                channel_points_wagered: Some(channel_points),
                ..Default::default()
            },
        )?;
        self.db.add_event(
            twitch_user_id,
            Some(session.id),
            "prediction_resolved",
            &format!("Prediction resolved with {result}."),
        )?;
        Ok(resolved)
    }

    pub async fn cancel(&self, twitch_user_id: &str) -> Result<PredictionSession> {
        self.require_user(twitch_user_id)?;
        let session = self.require_open_session(twitch_user_id)?;
        let prediction_id = session.twitch_prediction_id.clone().ok_or_else(|| {
            ServiceError::Message("The active prediction is missing its Twitch ID.".into())
        })?;

        let access_token = self.fresh_access_token(twitch_user_id).await?;
        if let Err(error) = self
            .twitch
            .cancel_prediction(&access_token, twitch_user_id, &prediction_id)
            .await
        {
            self.log_action_error(twitch_user_id, session.id, &error.to_string())?;
            return Err(ServiceError::Twitch(error));
        }

        let cancelled = self.db.update_session(
            session.id,
            SessionUpdate {
                status: "cancelled".into(),
                resolved_at: Some(now()),
                result: Some("cancelled".into()),
                ..Default::default()
            },
        )?;
        self.db.add_event(
            twitch_user_id,
            Some(session.id),
            "prediction_cancelled",
            "Prediction cancelled.",
        )?;
        Ok(cancelled)
    }

    /// Return a non-expired access token, refreshing + persisting if needed.
    async fn fresh_access_token(&self, twitch_user_id: &str) -> Result<String> {
        let tokens = self
            .db
            .get_tokens()?
            .ok_or_else(|| ServiceError::Message("Twitch user is not connected.".into()))?;

        let needs_refresh = match chrono::DateTime::parse_from_rfc3339(&tokens.token_expires_at) {
            Ok(expires) => {
                expires.with_timezone(&Utc) <= Utc::now() + chrono::Duration::seconds(60)
            }
            Err(_) => true,
        };
        if !needs_refresh {
            return Ok(tokens.access_token);
        }

        let refreshed = self.twitch.refresh_token(&tokens.refresh_token).await?;
        let new_refresh = refreshed
            .refresh_token
            .clone()
            .unwrap_or_else(|| tokens.refresh_token.clone());
        let expires_at = TwitchClient::token_expires_at(refreshed.expires_in);
        self.db.update_tokens(
            twitch_user_id,
            &refreshed.access_token,
            &new_refresh,
            &expires_at,
        )?;
        Ok(refreshed.access_token)
    }

    fn require_user(&self, twitch_user_id: &str) -> Result<()> {
        self.db
            .get_user_by_twitch_id(twitch_user_id)?
            .ok_or_else(|| ServiceError::Message("Twitch user is not connected.".into()))?;
        Ok(())
    }

    fn require_open_session(&self, twitch_user_id: &str) -> Result<PredictionSession> {
        match self.db.get_active_session(twitch_user_id)? {
            Some(session) if session.status == "prediction_open" => Ok(session),
            _ => Err(ServiceError::Message("There is no open prediction.".into())),
        }
    }

    fn mark_failed(&self, twitch_user_id: &str, session_id: i64, message: &str) -> Result<()> {
        self.db.update_session(
            session_id,
            SessionUpdate {
                status: "failed".into(),
                resolved_at: Some(now()),
                result: Some("create_failed".into()),
                ..Default::default()
            },
        )?;
        self.db
            .add_event(twitch_user_id, Some(session_id), "prediction_error", message)?;
        Ok(())
    }

    fn log_action_error(&self, twitch_user_id: &str, session_id: i64, message: &str) -> Result<()> {
        self.db
            .add_event(twitch_user_id, Some(session_id), "prediction_error", message)?;
        Ok(())
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::db::{PresetInput, UpsertUser};
    use crate::twitch::{Prediction, PredictionOutcome, Result as TwitchResult, TokenResponse};

    #[derive(Default)]
    struct FakeTwitch {
        create_should_fail: bool,
        refresh_called: AtomicBool,
    }

    #[async_trait::async_trait]
    impl TwitchApi for FakeTwitch {
        async fn refresh_token(&self, _refresh_token: &str) -> TwitchResult<TokenResponse> {
            self.refresh_called.store(true, Ordering::SeqCst);
            Ok(TokenResponse {
                access_token: "refreshed-access".into(),
                refresh_token: Some("refreshed-refresh".into()),
                expires_in: 3600,
            })
        }
        async fn create_prediction(
            &self,
            _access_token: &str,
            _broadcaster_id: &str,
            input: &CreatePredictionInput,
        ) -> TwitchResult<Prediction> {
            if self.create_should_fail {
                return Err(TwitchError::Api {
                    label: "Twitch API".into(),
                    status: 400,
                    message: "channel points not enabled".into(),
                });
            }
            Ok(Prediction {
                id: "pred-1".into(),
                title: input.title.clone(),
                status: "ACTIVE".into(),
                outcomes: vec![
                    PredictionOutcome {
                        id: "outcome-a".into(),
                        title: input.outcome_a.clone(),
                        channel_points: 0,
                    },
                    PredictionOutcome {
                        id: "outcome-b".into(),
                        title: input.outcome_b.clone(),
                        channel_points: 0,
                    },
                ],
            })
        }
        async fn resolve_prediction(
            &self,
            _access_token: &str,
            _broadcaster_id: &str,
            _prediction_id: &str,
            _winning_outcome_id: &str,
        ) -> TwitchResult<Prediction> {
            Ok(Prediction {
                id: "pred-1".into(),
                title: "t".into(),
                status: "RESOLVED".into(),
                outcomes: vec![
                    PredictionOutcome {
                        id: "outcome-a".into(),
                        title: "Yes".into(),
                        channel_points: 1250,
                    },
                    PredictionOutcome {
                        id: "outcome-b".into(),
                        title: "No".into(),
                        channel_points: 750,
                    },
                ],
            })
        }
        async fn cancel_prediction(
            &self,
            _access_token: &str,
            _broadcaster_id: &str,
            _prediction_id: &str,
        ) -> TwitchResult<()> {
            Ok(())
        }
    }

    fn setup(twitch: Arc<dyn TwitchApi>) -> (PredictionService, Arc<Db>) {
        let db = Arc::new(Db::open_in_memory().unwrap());
        db.upsert_user(UpsertUser {
            twitch_user_id: "123".into(),
            twitch_login: "ace".into(),
            twitch_display_name: "Ace".into(),
            twitch_profile_image_url: None,
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            token_expires_at: "2030-01-01T00:00:00.000Z".into(),
        })
        .unwrap();
        (PredictionService::new(db.clone(), twitch), db)
    }

    fn enable_competitive(db: &Db) {
        db.save_preset(
            "123",
            "competitive",
            PresetInput {
                enabled: true,
                title_template: "Will {streamer} win?".into(),
                outcome_a: "Yes".into(),
                outcome_b: "No".into(),
                prediction_window: 120,
                win_outcome: "A".into(),
            },
        )
        .unwrap();
    }

    #[tokio::test]
    async fn creates_prediction_for_enabled_mode() {
        let (service, db) = setup(Arc::new(FakeTwitch::default()));
        enable_competitive(&db);

        let result = service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap();

        assert_eq!(result.action, "prediction_created");
        let session = result.session.unwrap();
        assert_eq!(session.status, "prediction_open");
        assert_eq!(session.title, "Will ace win?");
        assert_eq!(session.twitch_prediction_id.as_deref(), Some("pred-1"));

        let events = db.get_recent_events("123", 5).unwrap();
        assert_eq!(events[0].event_type, "prediction_created");
    }

    #[tokio::test]
    async fn ignores_unknown_and_disabled_modes() {
        let (service, db) = setup(Arc::new(FakeTwitch::default()));

        let unknown = service
            .handle_match_start("123", "manual", "unknown")
            .await
            .unwrap();
        assert_eq!(unknown.action, "ignored");

        // custom preset defaults to disabled
        let disabled = service
            .handle_match_start("123", "manual", "custom")
            .await
            .unwrap();
        assert_eq!(disabled.action, "ignored");
        assert!(db.get_active_session("123").unwrap().is_none());
    }

    #[tokio::test]
    async fn ignores_when_a_prediction_is_already_active() {
        let (service, db) = setup(Arc::new(FakeTwitch::default()));
        enable_competitive(&db);

        service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap();
        let again = service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap();
        assert_eq!(again.action, "ignored");
        assert!(again.message.contains("already active"));
    }

    #[tokio::test]
    async fn resolves_and_tallies_channel_points() {
        let (service, db) = setup(Arc::new(FakeTwitch::default()));
        enable_competitive(&db);
        service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap();

        let resolved = service.resolve("123", Winner::A).await.unwrap();
        assert_eq!(resolved.status, "resolved");
        assert_eq!(resolved.result.as_deref(), Some("outcome_a"));
        assert_eq!(resolved.channel_points_wagered, 2000);
        assert!(db.get_active_session("123").unwrap().is_none());
    }

    #[tokio::test]
    async fn cancels_an_open_prediction() {
        let (service, db) = setup(Arc::new(FakeTwitch::default()));
        enable_competitive(&db);
        service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap();

        let cancelled = service.cancel("123").await.unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert!(db.get_active_session("123").unwrap().is_none());
    }

    #[tokio::test]
    async fn resolve_without_open_prediction_errors() {
        let (service, _db) = setup(Arc::new(FakeTwitch::default()));
        let err = service.resolve("123", Winner::A).await.unwrap_err();
        assert!(matches!(err, ServiceError::Message(message) if message.contains("no open prediction")));
    }

    #[tokio::test]
    async fn create_failure_marks_session_failed_and_propagates() {
        let (service, db) = setup(Arc::new(FakeTwitch {
            create_should_fail: true,
            ..Default::default()
        }));
        enable_competitive(&db);

        let err = service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::Twitch(_)));

        // No active session remains (it was marked failed), and an error event logged.
        assert!(db.get_active_session("123").unwrap().is_none());
        let events = db.get_recent_events("123", 5).unwrap();
        assert_eq!(events[0].event_type, "prediction_error");
    }

    #[tokio::test]
    async fn refreshes_expired_token_before_creating() {
        let fake = Arc::new(FakeTwitch::default());
        let db = Arc::new(Db::open_in_memory().unwrap());
        db.upsert_user(UpsertUser {
            twitch_user_id: "123".into(),
            twitch_login: "ace".into(),
            twitch_display_name: "Ace".into(),
            twitch_profile_image_url: None,
            access_token: "stale".into(),
            refresh_token: "refresh-1".into(),
            token_expires_at: "2000-01-01T00:00:00.000Z".into(),
        })
        .unwrap();
        enable_competitive(&db);
        let service = PredictionService::new(db.clone(), fake.clone());

        service
            .handle_match_start("123", "manual", "competitive")
            .await
            .unwrap();

        assert!(fake.refresh_called.load(Ordering::SeqCst));
        assert_eq!(db.get_tokens().unwrap().unwrap().access_token, "refreshed-access");
    }
}
