use std::time::{Duration, Instant};

use valorpredict_lib::{
    hashing::hash_match_id,
    models::{ValorantGameMode, ValorantLocalState},
    process_detection::{record_process_name, ProcessSignals},
    riot_local_client::{extract_match_id, normalize_game_mode, parse_region_shard_from_log},
    riot_lockfile::Lockfile,
    valorant_detector::{DetectionDecision, DetectionSnapshot, DetectorMemory},
};

#[test]
fn process_matching_is_case_insensitive_and_stops_when_complete() {
    let mut signals = ProcessSignals::default();
    assert!(!record_process_name(&mut signals, "RIOTCLIENTSERVICES.EXE"));
    assert!(signals.riot_client_running);
    assert!(!signals.valorant_running);
    assert!(record_process_name(
        &mut signals,
        "Valorant-Win64-Shipping.exe"
    ));
    assert_eq!(
        signals,
        ProcessSignals {
            riot_client_running: true,
            valorant_running: true,
        }
    );
}

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
    // The live core-game endpoint uses `ProvisioningFlow` (no "ID").
    let custom_in_match = serde_json::json!({
        "MatchID": "custom-live-id",
        "QueueID": "",
        "ProvisioningFlow": "CustomGame"
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
    assert_eq!(
        normalize_game_mode(&custom_in_match),
        ValorantGameMode::Custom
    );
    assert_eq!(normalize_game_mode(&unsupported), ValorantGameMode::Unknown);
    assert_eq!(normalize_game_mode(&conflicting), ValorantGameMode::Unknown);
    assert_eq!(
        normalize_game_mode(&serde_json::json!({})),
        ValorantGameMode::Unknown
    );
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

#[test]
fn riot_is_only_contacted_while_valorant_is_running() {
    use valorpredict_lib::valorant_detector::{can_fetch_result, idle_snapshot, needs_riot_session};

    let both = ProcessSignals {
        riot_client_running: true,
        valorant_running: true,
    };
    let riot_only = ProcessSignals {
        riot_client_running: true,
        valorant_running: false,
    };
    let valorant_only = ProcessSignals {
        riot_client_running: false,
        valorant_running: true,
    };
    assert!(needs_riot_session(both));
    assert!(!needs_riot_session(riot_only));
    assert!(!needs_riot_session(valorant_only));
    assert!(!needs_riot_session(ProcessSignals::default()));

    // Result lookups may use a held session after VALORANT closes, never without one.
    assert!(can_fetch_result(both, false));
    assert!(can_fetch_result(riot_only, true));
    assert!(!can_fetch_result(riot_only, false));
    assert!(!can_fetch_result(valorant_only, true));

    let idle = idle_snapshot(riot_only, true);
    assert_eq!(idle.state, ValorantLocalState::NotRunning);
    assert!(idle.processes.riot_client_running);
    assert!(idle.lockfile_found);
    assert_eq!(idle.evidence, vec!["valorant_process_not_found"]);
    assert_eq!(
        idle_snapshot(ProcessSignals::default(), false).evidence,
        vec!["riot_client_process_not_found"]
    );
}

#[test]
fn poll_delay_follows_the_state_table() {
    use valorpredict_lib::valorant_detector::next_poll_delay;

    let secs = |state: ValorantLocalState, active: bool| next_poll_delay(&state, active).as_secs();
    let cases = [
        (ValorantLocalState::NotRunning, false, 20),
        (ValorantLocalState::Menus, false, 15),
        (ValorantLocalState::Unknown, false, 15),
        (ValorantLocalState::PreGame, false, 5),
        (ValorantLocalState::CurrentGame, false, 20),
        // In a match with a prediction open.
        (ValorantLocalState::CurrentGame, true, 20),
        // Match over, waiting for the result.
        (ValorantLocalState::Menus, true, 10),
        (ValorantLocalState::NotRunning, true, 10),
        (ValorantLocalState::Unknown, true, 10),
        // Agent select is always fast.
        (ValorantLocalState::PreGame, true, 5),
    ];
    for (state, active, expected) in cases {
        assert_eq!(secs(state.clone(), active), expected, "{state:?} active={active}");
    }
}

#[test]
fn old_settings_files_with_a_poll_interval_still_load() {
    use valorpredict_lib::models::AppSettings;

    let old: AppSettings =
        serde_json::from_str(r#"{"pollIntervalSeconds":30,"monitoringEnabled":true}"#).unwrap();
    assert!(old.monitoring_enabled);
    let without: AppSettings = serde_json::from_str(r#"{"monitoringEnabled":true}"#).unwrap();
    assert_eq!(without.poll_interval_seconds, 15);
}

#[test]
fn status_payload_has_no_logs() {
    use valorpredict_lib::models::ValorantDetectionStatus;

    let json = serde_json::to_value(ValorantDetectionStatus::default()).unwrap();
    assert!(json.get("logs").is_none());
    assert!(json.get("cooldownRemainingSeconds").is_some());
}
