use tempfile::tempdir;
use valorpredict_lib::{
    commands::should_auto_start_monitoring,
    models::{
        clamp_poll_interval, AppSettings, DEFAULT_POLL_INTERVAL_SECONDS,
        MAX_POLL_INTERVAL_SECONDS, MIN_POLL_INTERVAL_SECONDS,
    },
    settings::SettingsStore,
};

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
fn settings_round_trip() {
    let directory = tempdir().unwrap();
    let store = SettingsStore::new(directory.path().join("settings.json"));
    let settings = AppSettings {
        poll_interval_seconds: 4,
        monitoring_enabled: true,
    };

    store.save(&settings).unwrap();
    assert_eq!(store.load().unwrap(), settings);
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
fn monitoring_auto_starts_when_the_preference_was_enabled() {
    // Local mode: the monitoring loop guards on a connected Twitch account, so
    // auto-start only depends on the remembered "was it running?" preference.
    let mut settings = AppSettings::default();
    assert!(!should_auto_start_monitoring(&settings));

    settings.monitoring_enabled = true;
    assert!(should_auto_start_monitoring(&settings));
}

#[test]
fn configured_and_rebuilt_windows_share_minimum_size() {
    let config = include_str!("../tauri.conf.json");
    let window_builder = include_str!("../src/lib.rs");
    assert!(config.contains(r#""minWidth": 560"#));
    assert!(config.contains(r#""minHeight": 640"#));
    assert!(window_builder.contains(".min_inner_size(560.0, 640.0)"));
}
