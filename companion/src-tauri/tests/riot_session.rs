//! The Riot session cache against a mock Riot (loopback + game servers).

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use httpmock::prelude::*;
use serde_json::json;

use valorpredict_lib::{
    metrics::DetectionMetrics,
    models::ValorantGameMode,
    riot_local_client::RiotLocalClient,
    riot_lockfile::Lockfile,
    riot_session::{RiotSession, SessionKey},
};

fn client_for(server: &MockServer, metrics: Arc<DetectionMetrics>) -> (SessionKey, RiotLocalClient) {
    let lockfile = Lockfile::parse(&format!("Riot Client:1:{}:pw:http", server.port())).unwrap();
    let key = SessionKey::new(&lockfile, Some(7));
    let client = RiotLocalClient::new(lockfile, metrics)
        .unwrap()
        .with_server_base_override(server.base_url());
    (key, client)
}

fn entitlements<'a>(server: &'a MockServer, access: &str, entitlement: &str) -> httpmock::Mock<'a> {
    server.mock(|when, then| {
        when.method(GET).path("/entitlements/v1/token");
        then.status(200).json_body(json!({
            "accessToken": access,
            "token": entitlement,
            "subject": "puuid-1"
        }));
    })
}

fn region_and_version(server: &MockServer) {
    server.mock(|when, then| {
        when.method(GET).path("/riotclient/region-locale");
        then.status(200)
            .json_body(json!({ "region": "na", "shard": "na" }));
    });
    server.mock(|when, then| {
        when.method(GET).path("/product-session/v1/external-sessions");
        then.status(200)
            .json_body(json!({ "abc": { "version": "release-10.01-shipping-1-1" } }));
    });
}

fn players<'a>(server: &'a MockServer, entitlement: &str, status: u16) -> httpmock::Mock<'a> {
    let entitlement = entitlement.to_string();
    server.mock(move |when, then| {
        when.method(GET)
            .path("/core-game/v1/players/puuid-1")
            .header("X-Riot-Entitlements-JWT", entitlement);
        if status == 200 {
            then.status(200).json_body(json!({ "MatchID": "match-1" }));
        } else {
            then.status(status);
        }
    })
}

#[tokio::test]
async fn auth_failure_refreshes_entitlements_once_and_retries_once() {
    let server = MockServer::start_async().await;
    let metrics = Arc::new(DetectionMetrics::new());
    let (key, client) = client_for(&server, metrics.clone());
    region_and_version(&server);
    let mut old = entitlements(&server, "access-old", "ent-old");
    let mut session = RiotSession::open_with(key, client, || panic!("log must not be read"))
        .await
        .unwrap();
    old.delete();

    let fresh = entitlements(&server, "access-new", "ent-new");
    let stale_players = players(&server, "ent-old", 401);
    let fresh_players = players(&server, "ent-new", 200);
    let details = server.mock(|when, then| {
        when.method(GET).path("/core-game/v1/matches/match-1");
        then.status(200)
            .json_body(json!({ "QueueID": "competitive" }));
    });

    let signal = session.current_game().await.unwrap().unwrap();
    assert_eq!(signal.match_id, "match-1");
    assert_eq!(signal.game_mode, ValorantGameMode::Competitive);
    assert_eq!(fresh.hits(), 1, "one entitlement refresh");
    assert_eq!(stale_players.hits(), 1, "one failing call");
    assert_eq!(fresh_players.hits(), 1, "one retry");

    // Later polls reuse the refreshed tokens and the cached game mode.
    session.current_game().await.unwrap().unwrap();
    assert_eq!(fresh.hits(), 1);
    assert_eq!(fresh_players.hits(), 2);
    assert_eq!(details.hits(), 1, "match details are fetched once per match id");

    // 3 loopback calls to build the session + 1 refresh.
    assert_eq!(metrics.view().loopback_calls_last_minute, 4);
}

#[tokio::test]
async fn a_second_auth_failure_is_returned_without_another_refresh() {
    let server = MockServer::start_async().await;
    let metrics = Arc::new(DetectionMetrics::new());
    let (key, client) = client_for(&server, metrics);
    region_and_version(&server);
    let tokens = entitlements(&server, "access", "ent");
    let mut session = RiotSession::open_with(key, client, || panic!("log must not be read"))
        .await
        .unwrap();
    let rejected = players(&server, "ent", 403);

    let error = session.current_game().await.unwrap_err();
    assert!(error.contains("403"), "{error}");
    assert_eq!(rejected.hits(), 2, "original call plus exactly one retry");
    assert_eq!(tokens.hits(), 2, "session build plus exactly one refresh");
    assert!(session.needs_rebuild(), "cache must rebuild the session next poll");
}

#[tokio::test]
async fn bad_request_counts_as_expired_tokens() {
    let server = MockServer::start_async().await;
    let (key, client) = client_for(&server, Arc::new(DetectionMetrics::new()));
    region_and_version(&server);
    let tokens = entitlements(&server, "access", "ent");
    let mut session = RiotSession::open_with(key, client, || None).await.unwrap();
    let rejected = players(&server, "ent", 400);

    assert!(session.current_game().await.is_err());
    assert_eq!(rejected.hits(), 2);
    assert_eq!(tokens.hits(), 2);
}

#[tokio::test]
async fn other_errors_and_missing_matches_do_not_refresh() {
    let server = MockServer::start_async().await;
    let (key, client) = client_for(&server, Arc::new(DetectionMetrics::new()));
    region_and_version(&server);
    let tokens = entitlements(&server, "access", "ent");
    let mut session = RiotSession::open_with(key, client, || None).await.unwrap();

    let mut missing = players(&server, "ent", 404);
    assert_eq!(session.current_game().await.unwrap(), None);
    missing.delete();
    let broken = players(&server, "ent", 500);
    assert!(session.current_game().await.is_err());
    assert_eq!(broken.hits(), 1);
    assert_eq!(tokens.hits(), 1, "only the session build read entitlements");
}

#[tokio::test]
async fn log_is_not_read_when_the_api_has_region_and_version() {
    let server = MockServer::start_async().await;
    let (_key, client) = client_for(&server, Arc::new(DetectionMetrics::new()));
    region_and_version(&server);
    entitlements(&server, "access", "ent");
    let reads = AtomicUsize::new(0);

    let context = client
        .session_context_with(|| {
            reads.fetch_add(1, Ordering::SeqCst);
            None
        })
        .await
        .unwrap();

    assert_eq!(reads.load(Ordering::SeqCst), 0);
    assert_eq!(context.region_shard.region, "na");
    assert_eq!(context.client_version, "release-10.01-shipping-1-1");
}

#[tokio::test]
async fn log_is_read_once_and_shared_by_both_fallbacks() {
    let server = MockServer::start_async().await;
    let (_key, client) = client_for(&server, Arc::new(DetectionMetrics::new()));
    entitlements(&server, "access", "ent");
    // region-locale and external-sessions are unmocked, so they return 404.
    let reads = AtomicUsize::new(0);

    let context = client
        .session_context_with(|| {
            reads.fetch_add(1, Ordering::SeqCst);
            Some(
                "LogNet: https://glz-eu-1.eu.a.pvp.net ... branch release-10.05-shipping-9-1"
                    .to_string(),
            )
        })
        .await
        .unwrap();

    assert_eq!(reads.load(Ordering::SeqCst), 1);
    assert_eq!(context.region_shard.region, "eu");
    assert_eq!(context.region_shard.shard, "eu");
    assert_eq!(context.client_version, "release-10.05-shipping");
}

#[tokio::test]
async fn a_different_account_rebuilds_the_context_on_refresh() {
    let server = MockServer::start_async().await;
    let (key, client) = client_for(&server, Arc::new(DetectionMetrics::new()));
    region_and_version(&server);
    let mut first = entitlements(&server, "access-1", "ent-1");
    let mut session = RiotSession::open_with(key, client, || None).await.unwrap();
    first.delete();
    server.mock(|when, then| {
        when.method(GET).path("/entitlements/v1/token");
        then.status(200).json_body(json!({
            "accessToken": "access-2", "token": "ent-2", "subject": "puuid-2"
        }));
    });
    let rejected = players(&server, "ent-1", 401);
    server.mock(|when, then| {
        when.method(GET)
            .path("/core-game/v1/players/puuid-2")
            .header("X-Riot-Entitlements-JWT", "ent-2");
        then.status(404);
    });

    assert_eq!(session.current_game().await.unwrap(), None);
    assert_eq!(rejected.hits(), 1);
    assert_eq!(session.context().puuid, "puuid-2");
}

#[tokio::test]
async fn context_with_unknown_region_is_refused() {
    let server = MockServer::start_async().await;
    let (_key, client) = client_for(&server, Arc::new(DetectionMetrics::new()));
    entitlements(&server, "access", "ent");
    server.mock(|when, then| {
        when.method(GET).path("/product-session/v1/external-sessions");
        then.status(200)
            .json_body(json!({ "abc": { "version": "release-10.01-shipping-1-1" } }));
    });
    // region-locale is unmocked (404) and the log has nothing.
    assert!(client.session_context_with(|| None).await.is_err());
}
