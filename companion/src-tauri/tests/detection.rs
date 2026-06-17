use std::time::{Duration, Instant};

use valorant_auto_predictions_companion_lib::{
    hashing::hash_match_id,
    models::{ValorantGameMode, ValorantLocalState},
    riot_local_client::{extract_match_id, normalize_game_mode, parse_region_shard_from_log},
    riot_lockfile::Lockfile,
    valorant_detector::{DetectionDecision, DetectionSnapshot, DetectorMemory},
};

#[test]
fn lockfile_parser_is_strict_and_debug_output_hides_password() {
    let lockfile = Lockfile::parse("Riot Client:1234:54321:super-secret:https").unwrap();

    assert_eq!(lockfile.pid, 1234);
    assert_eq!(lockfile.port, 54321);
    assert_eq!(lockfile.protocol, "https");
    assert!(!format!("{lockfile:?}").contains("super-secret"));
    assert!(Lockfile::parse("missing:fields").is_err());
}

#[test]
fn riot_match_details_normalize_only_supported_game_modes() {
    let competitive = serde_json::json!({
        "MatchID": "competitive-id",
        "QueueID": "competitive",
        "ProvisioningFlowID": "Matchmaking"
    });
    let custom = serde_json::json!({
        "MatchID": "custom-id",
        "QueueID": "",
        "ProvisioningFlowID": "CustomGame"
    });
    let unsupported = serde_json::json!({
        "QueueID": "unrated",
        "ProvisioningFlowID": "Matchmaking"
    });
    let conflicting = serde_json::json!({
        "QueueID": "competitive",
        "ProvisioningFlowID": "CustomGame"
    });

    assert_eq!(
        normalize_game_mode(&competitive),
        ValorantGameMode::Competitive
    );
    assert_eq!(normalize_game_mode(&custom), ValorantGameMode::Custom);
    assert_eq!(normalize_game_mode(&unsupported), ValorantGameMode::Unknown);
    assert_eq!(normalize_game_mode(&conflicting), ValorantGameMode::Unknown);
    assert_eq!(
        normalize_game_mode(&serde_json::json!({})),
        ValorantGameMode::Unknown
    );
}

#[test]
fn backend_payload_contains_only_the_normalized_game_mode() {
    let snapshot = DetectionSnapshot::simulated(
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Custom,
        Some("a".repeat(64)),
        0.95,
    );
    let serialized = serde_json::to_value(snapshot.to_payload()).unwrap();

    assert_eq!(serialized["gameMode"], "custom");
    assert!(serialized.get("queueID").is_none());
    assert!(serialized.get("provisioningFlowID").is_none());
    assert!(!serialized.to_string().contains("riot-token"));
}

#[test]
fn match_ids_are_hashed_before_leaving_detection() {
    assert_eq!(
        hash_match_id("raw-match-id"),
        "793babf0a3cb0d0f3206681c129dd437df6baf60ba3dd4a525f6d7c75f0698bb"
    );
}

#[test]
fn riot_response_and_log_helpers_extract_only_needed_values() {
    let player = serde_json::json!({
        "Subject": "puuid",
        "MatchID": "raw-match-id",
        "Version": 3
    });
    assert_eq!(extract_match_id(&player).as_deref(), Some("raw-match-id"));

    let log = "https://glz-na-1.na.a.pvp.net/core-game/v1/players/abc";
    assert_eq!(
        parse_region_shard_from_log(log),
        Some(("na".into(), "na".into()))
    );
}

#[test]
fn detector_dedupes_current_game_and_delays_exit() {
    let start = Instant::now();
    let mut memory = DetectorMemory::default();
    let game = DetectionSnapshot::simulated(
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Competitive,
        Some("a".repeat(64)),
        0.95,
    );

    assert_eq!(
        memory.evaluate(&game, start),
        DetectionDecision::Send(game.clone())
    );
    assert_eq!(
        memory.evaluate(&game, start + Duration::from_secs(5)),
        DetectionDecision::Suppress
    );

    let menus = DetectionSnapshot::simulated(
        ValorantLocalState::Menus,
        ValorantGameMode::Unknown,
        None,
        0.5,
    );
    assert_eq!(
        memory.evaluate(&menus, start + Duration::from_secs(10)),
        DetectionDecision::Suppress
    );
    assert_eq!(
        memory.evaluate(&menus, start + Duration::from_secs(15)),
        DetectionDecision::Send(menus)
    );
}

#[test]
fn detector_applies_a_ten_minute_per_match_cooldown() {
    let start = Instant::now();
    let mut memory = DetectorMemory::default();
    let first = DetectionSnapshot::simulated(
        ValorantLocalState::CurrentGame,
        ValorantGameMode::Competitive,
        Some("b".repeat(64)),
        0.95,
    );

    memory.evaluate(&first, start);
    let menus = DetectionSnapshot::simulated(
        ValorantLocalState::Menus,
        ValorantGameMode::Unknown,
        None,
        0.5,
    );
    memory.evaluate(&menus, start + Duration::from_secs(5));
    memory.evaluate(&menus, start + Duration::from_secs(10));

    assert_eq!(
        memory.evaluate(&first, start + Duration::from_secs(30)),
        DetectionDecision::Suppress
    );
    assert_eq!(
        memory.evaluate(&first, start + Duration::from_secs(601)),
        DetectionDecision::Send(first)
    );
}
