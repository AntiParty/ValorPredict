import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import type {
  AutoPredictionPreset,
  DashboardData,
  DetectionStatus,
  MeResponse,
  PredictionSession,
  SafeUser,
} from "../types";

// Dev-only stand-in for the Rust backend so the UI can be worked on in a plain browser
// (`npm run dev`, then open http://localhost:1420/?scenario=live). Never bundled into
// release builds: main.tsx only imports it when there is no Tauri bridge in dev.
//
// Scenarios: onboarding | paused | waiting | menus | agent-select | match | live | reauth

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const user: SafeUser = {
  id: 1,
  twitch_user_id: "42",
  twitch_login: "nightjar_val",
  twitch_display_name: "nightjar_val",
  twitch_profile_image_url: null,
  token_expires_at: "2099-01-01T00:00:00Z",
  created_at: minutesAgo(60 * 24 * 30),
  updated_at: minutesAgo(60),
};

function preset(gameMode: "competitive" | "custom", enabled: boolean): AutoPredictionPreset {
  return {
    id: gameMode === "competitive" ? 1 : 2,
    twitch_user_id: "42",
    game_mode: gameMode,
    enabled: enabled ? 1 : 0,
    title_template: gameMode === "competitive" ? "Will {streamer} win this match?" : "Custom: does {streamer} win?",
    outcome_a: "Win",
    outcome_b: "Loss",
    prediction_window: 120,
    win_outcome: "A",
    created_at: minutesAgo(60 * 24 * 30),
    updated_at: minutesAgo(60 * 24),
  };
}

const live: PredictionSession = {
  id: 7,
  twitch_user_id: "42",
  status: "prediction_open",
  twitch_prediction_id: "prediction-7",
  outcome_a_label: "Win",
  outcome_b_label: "Loss",
  title: "Will nightjar_val win this match?",
  started_at: minutesAgo(3),
  resolved_at: null,
  result: null,
  channel_points_wagered: 0,
  created_at: minutesAgo(3),
  updated_at: minutesAgo(3),
};

function status(overrides: Partial<DetectionStatus>): DetectionStatus {
  return {
    riotLockfileFound: true,
    riotClientRunning: true,
    valorantRunning: true,
    region: "na",
    shard: "na",
    localState: "menus",
    gameMode: "unknown",
    confidence: 1,
    lastMatchIdHash: null,
    cooldownRemainingSeconds: 0,
    lastBackendResponse: "Waiting.",
    monitoring: true,
    ...overrides,
  };
}

const STATUS: Record<string, DetectionStatus> = {
  paused: status({ monitoring: false, valorantRunning: false, localState: "not_running" }),
  waiting: status({ valorantRunning: false, riotClientRunning: false, localState: "not_running" }),
  menus: status({ localState: "menus" }),
  "agent-select": status({ localState: "pre_game", gameMode: "competitive" }),
  match: status({ localState: "current_game", gameMode: "competitive" }),
  live: status({ localState: "current_game", gameMode: "competitive" }),
  reauth: status({ localState: "menus" }),
};

export function installMockBackend() {
  const scenario = new URLSearchParams(location.search).get("scenario") ?? "live";
  let current = STATUS[scenario] ?? STATUS.menus;
  const presets = [preset("competitive", true), preset("custom", false)];

  const me: MeResponse = {
    user: scenario === "onboarding" ? null : user,
    configured: true,
    redirectUri: "http://localhost:3000/auth/twitch/callback",
    authMode: "hosted",
    hostedAvailable: true,
    reauthRequired: scenario === "reauth",
  };

  const dashboard = (): DashboardData => ({
    user,
    presets,
    activeSession: scenario === "live" ? live : null,
    events: [
      {
        id: 3,
        twitch_user_id: "42",
        session_id: 6,
        type: "prediction_resolved",
        message: "Resolved to Win after a 13-9 match on Ascent.",
        created_at: minutesAgo(48),
      },
      {
        id: 2,
        twitch_user_id: "42",
        session_id: 6,
        type: "prediction_created",
        message: "Opened \"Will nightjar_val win this match?\" for 120 seconds.",
        created_at: minutesAgo(86),
      },
    ],
    developmentMode: false,
  });

  mockWindows("main");
  mockIPC(
    (cmd) => {
      switch (cmd) {
        case "get_me":
          return me;
        case "get_status":
          return current;
        case "get_dashboard":
          return dashboard();
        case "start_monitoring":
          current = { ...current, monitoring: true };
          return current;
        case "stop_monitoring":
          current = { ...current, monitoring: false };
          return current;
        case "get_logs":
          return [];
        case "get_detection_metrics":
          return {
            lastPollMs: 12,
            loopbackCallsLastMinute: 4,
            riotServerCallsLastMinute: 3,
            logReadsLastMinute: 0,
            processScansLastMinute: 6,
          };
        case "save_preset":
          return presets[0];
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
