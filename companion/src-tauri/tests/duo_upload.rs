use httpmock::prelude::*;
use serde_json::json;
use valorant_auto_predictions_companion_lib::{
    backend_client::BackendClient,
    models::AppSettings,
    riot_local_client::{DuoParty, DuoPartyMember},
};

fn settings(base_url: String) -> AppSettings {
    AppSettings {
        backend_url: base_url,
        local_api_key: "vap_test_key".into(),
        poll_interval_seconds: 15,
        monitoring_enabled: false,
    }
}

#[tokio::test]
async fn ping_reports_duo_enablement() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(GET).path("/api/local/ping");
            then.status(200).json_body_obj(&json!({
                "ok": true,
                "twitchUserId": "1",
                "twitchLogin": "ace",
                "duoEnabled": true
            }));
        })
        .await;

    let outcome = BackendClient::default()
        .ping(&settings(server.base_url()))
        .await
        .unwrap();

    assert!(outcome.ok);
    assert!(outcome.duo_enabled);
    assert!(outcome.message.contains("ace"));
}

#[tokio::test]
async fn ping_defaults_duo_enablement_to_off_when_absent() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(GET).path("/api/local/ping");
            then.status(200).json_body_obj(&json!({
                "ok": true,
                "twitchUserId": "1",
                "twitchLogin": "ace"
            }));
        })
        .await;

    let outcome = BackendClient::default()
        .ping(&settings(server.base_url()))
        .await
        .unwrap();

    assert!(!outcome.duo_enabled);
}

#[tokio::test]
async fn upload_duo_publishes_party_members() {
    let server = MockServer::start_async().await;
    let upload = server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/api/local/duo")
                .header("authorization", "Bearer vap_test_key")
                .json_body_obj(&json!({
                    "inParty": true,
                    "members": [{ "riotId": "Phoenix#NA1", "name": "Phoenix" }]
                }));
            then.status(200).json_body_obj(&json!({
                "ok": true,
                "action": "stored",
                "accepted": 1
            }));
        })
        .await;

    let party = DuoParty {
        in_party: true,
        members: vec![DuoPartyMember {
            riot_id: "Phoenix#NA1".into(),
            name: "Phoenix".into(),
        }],
    };

    let response = BackendClient::default()
        .upload_duo(&settings(server.base_url()), &party)
        .await
        .unwrap();

    upload.assert_async().await;
    assert!(response.ok);
    assert_eq!(response.action, "stored");
}

#[tokio::test]
async fn upload_duo_reports_disabled_without_storing() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST).path("/api/local/duo");
            then.status(200).json_body_obj(&json!({
                "ok": true,
                "action": "ignored",
                "message": "Duo command is disabled."
            }));
        })
        .await;

    let party = DuoParty {
        in_party: false,
        members: Vec::new(),
    };

    let response = BackendClient::default()
        .upload_duo(&settings(server.base_url()), &party)
        .await
        .unwrap();

    assert_eq!(response.action, "ignored");
}
