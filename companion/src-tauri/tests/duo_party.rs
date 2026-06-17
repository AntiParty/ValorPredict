use serde_json::json;
use valorant_auto_predictions_companion_lib::riot_local_client::{
    extract_current_party_id, parse_name_service, visible_party_subjects, DuoPartyMember,
};

#[test]
fn current_party_id_is_read_only_when_present() {
    let players = json!({
        "Subject": "self-puuid",
        "Version": 1,
        "CurrentPartyID": "party-123"
    });
    assert_eq!(
        extract_current_party_id(&players).as_deref(),
        Some("party-123")
    );

    let empty = json!({ "Subject": "self-puuid", "CurrentPartyID": "" });
    assert_eq!(extract_current_party_id(&empty), None);

    assert_eq!(extract_current_party_id(&json!({})), None);
}

#[test]
fn party_members_exclude_self_and_incognito_players() {
    let party = json!({
        "ID": "party-123",
        "Members": [
            { "Subject": "self-puuid", "PlayerIdentity": { "Incognito": false } },
            { "Subject": "friend-visible", "PlayerIdentity": { "Incognito": false } },
            { "Subject": "friend-hidden", "PlayerIdentity": { "Incognito": true } },
            { "Subject": "friend-no-identity" }
        ]
    });

    assert_eq!(
        visible_party_subjects(&party, "self-puuid"),
        vec![
            "friend-visible".to_string(),
            "friend-no-identity".to_string()
        ]
    );
}

#[test]
fn party_without_members_yields_no_subjects() {
    assert!(visible_party_subjects(&json!({ "ID": "party" }), "self-puuid").is_empty());
    assert!(visible_party_subjects(&json!({ "Members": [] }), "self-puuid").is_empty());
}

#[test]
fn name_service_response_builds_riot_ids_and_skips_blank_names() {
    let response = json!([
        { "Subject": "friend-visible", "GameName": "Phoenix", "TagLine": "NA1" },
        { "Subject": "friend-no-identity", "GameName": "Sage", "TagLine": "EU2" },
        { "Subject": "broken", "GameName": "", "TagLine": "NA1" },
        { "Subject": "tagless", "GameName": "Jett", "TagLine": "" }
    ]);

    assert_eq!(
        parse_name_service(&response),
        vec![
            DuoPartyMember {
                riot_id: "Phoenix#NA1".into(),
                name: "Phoenix".into()
            },
            DuoPartyMember {
                riot_id: "Sage#EU2".into(),
                name: "Sage".into()
            },
            DuoPartyMember {
                riot_id: "Jett".into(),
                name: "Jett".into()
            },
        ]
    );
}
