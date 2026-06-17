use httpmock::prelude::*;
use tempfile::tempdir;
use valorant_auto_predictions_companion_lib::{
    backend_client::BackendClient,
    commands::{should_auto_start_monitoring, simulated_payload},
    models::{
        clamp_poll_interval, AppSettings, BackendEventDetails, BackendEventPayload,
        ValorantGameMode, ValorantLocalState, DEFAULT_POLL_INTERVAL_SECONDS,
        MAX_POLL_INTERVAL_SECONDS, MIN_POLL_INTERVAL_SECONDS,
    },
    settings::SettingsStore,
};

#[test]
fn simulations_build_distinct_competitive_and_custom_payloads() {
    let competitive = simulated_payload(
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Competitive,
        "a".repeat(64),
        0.95,
    );
    let custom = simulated_payload(
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Custom,
        "b".repeat(64),
        0.95,
    );

    assert_eq!(competitive.game_mode, ValorantGameMode::Competitive);
    assert_eq!(custom.game_mode, ValorantGameMode::Custom);
    assert_eq!(
        competitive.details.evidence,
        vec!["simulated_current_game_competitive"]
    );
    assert_eq!(
        custom.details.evidence,
        vec!["simulated_current_game_custom"]
    );
}

#[test]
fn polling_defaults_prioritize_low_resource_usage() {
    assert_eq!(
        AppSettings::default().poll_interval_seconds,
        DEFAULT_POLL_INTERVAL_SECONDS
    );
    assert_eq!(clamp_poll_interval(3), MIN_POLL_INTERVAL_SECONDS);
    assert_eq!(clamp_poll_interval(15), 15);
    assert_eq!(clamp_poll_interval(120), MAX_POLL_INTERVAL_SECONDS);
}

#[test]
fn settings_round_trip_and_mask_the_api_key() {
    let directory = tempdir().unwrap();
    let store = SettingsStore::new(directory.path().join("settings.json"));
    let settings = AppSettings {
        backend_url: "http://localhost:3000".into(),
        local_api_key: "vap_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG".into(),
        poll_interval_seconds: 4,
        monitoring_enabled: true,
    };

    store.save(&settings).unwrap();
    assert_eq!(store.load().unwrap(), settings);
    let masked = settings.masked_api_key();
    assert!(masked.starts_with("vap_"));
    assert!(!masked.contains("abcdefghijklmnopqrstuvwxyz"));
    assert!(store.load().unwrap().monitoring_enabled);
}

#[test]
fn legacy_settings_default_monitoring_to_off() {
    let directory = tempdir().unwrap();
    let store = SettingsStore::new(directory.path().join("settings.json"));
    std::fs::write(
        store.path(),
        r#"{
          "backendUrl": "http://localhost:3000",
          "localApiKey": "vap_existing",
          "pollIntervalSeconds": 4
        }"#,
    )
    .unwrap();

    assert!(!store.load().unwrap().monitoring_enabled);
}

#[test]
fn monitoring_auto_starts_only_when_enabled_with_a_saved_key() {
    let mut settings = AppSettings::default();
    assert!(!should_auto_start_monitoring(&settings));

    settings.monitoring_enabled = true;
    assert!(!should_auto_start_monitoring(&settings));

    settings.local_api_key = "vap_test_key".into();
    assert!(should_auto_start_monitoring(&settings));
}

#[tokio::test]
async fn backend_ping_uses_the_local_key_without_returning_it() {
    let server = MockServer::start_async().await;
    let ping = server
        .mock_async(|when, then| {
            when.method(GET)
                .path("/api/local/ping")
                .header("authorization", "Bearer vap_test_key");
            then.status(200).json_body_obj(&serde_json::json!({
                "ok": true,
                "twitchUserId": "123",
                "twitchLogin": "ace"
            }));
        })
        .await;
    let settings = AppSettings {
        backend_url: server.base_url(),
        local_api_key: "vap_test_key".into(),
        poll_interval_seconds: 4,
        monitoring_enabled: false,
    };

    let response = BackendClient::default().ping(&settings).await.unwrap();

    ping.assert_async().await;
    assert!(response.ok);
    assert!(!response.message.contains("vap_test_key"));
}

#[tokio::test]
async fn current_game_falls_back_when_state_endpoint_is_missing() {
    let server = MockServer::start_async().await;
    let state = server
        .mock_async(|when, then| {
            when.method(POST).path("/api/local/valorant-state");
            then.status(404);
        })
        .await;
    let fallback = server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/api/local/valorant-match-start")
                .header("authorization", "Bearer vap_test_key")
                .json_body_partial(r#"{"gameMode":"competitive"}"#);
            then.status(200).json_body_obj(&serde_json::json!({
                "ok": true,
                "action": "prediction_created",
                "message": "Twitch prediction created.",
                "session": null
            }));
        })
        .await;
    let settings = AppSettings {
        backend_url: server.base_url(),
        local_api_key: "vap_test_key".into(),
        poll_interval_seconds: 4,
        monitoring_enabled: false,
    };
    let payload = BackendEventPayload {
        source: "local_companion".into(),
        state: ValorantLocalState::CurrentGame,
        game_mode: ValorantGameMode::Competitive,
        confidence: 0.95,
        match_id_hash: Some("a".repeat(64)),
        details: BackendEventDetails {
            detection_method: "simulation".into(),
            region: "unknown".into(),
            shard: "unknown".into(),
            evidence: vec!["simulated_current_game".into()],
        },
    };

    let response = BackendClient::default()
        .send_state(&settings, &payload)
        .await
        .unwrap();

    state.assert_async().await;
    fallback.assert_async().await;
    assert_eq!(response.action, "prediction_created");
}
