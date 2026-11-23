import type {
  AutoPredictionPreset,
  DashboardData,
  DetectionStatus,
  PredictionEvent,
  PredictionSession,
  SafeUser,
} from "../types";

export const user: SafeUser = {
  id: 1,
  twitch_user_id: "42",
  twitch_login: "test_streamer",
  twitch_display_name: "Test Streamer",
  twitch_profile_image_url: null,
  token_expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const idleStatus: DetectionStatus = {
  riotLockfileFound: false,
  riotClientRunning: false,
  valorantRunning: false,
  region: "unknown",
  shard: "unknown",
  localState: "unknown",
  gameMode: "unknown",
  confidence: 0,
  lastMatchIdHash: null,
  cooldownRemainingSeconds: 0,
  lastBackendResponse: "Waiting.",
  monitoring: false,
};

export function preset(
  gameMode: "competitive" | "custom",
  enabled: boolean,
  overrides: Partial<AutoPredictionPreset> = {},
): AutoPredictionPreset {
  return {
    id: gameMode === "competitive" ? 1 : 2,
    twitch_user_id: "42",
    game_mode: gameMode,
    enabled: enabled ? 1 : 0,
    title_template: "Will {streamer} win this match?",
    outcome_a: "Win",
    outcome_b: "Loss",
    prediction_window: 120,
    win_outcome: "A",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export const liveSession: PredictionSession = {
  id: 7,
  twitch_user_id: "42",
  status: "prediction_open",
  twitch_prediction_id: "prediction-7",
  outcome_a_label: "Win",
  outcome_b_label: "Loss",
  title: "Will test_streamer win this match?",
  started_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  resolved_at: null,
  result: null,
  channel_points_wagered: 0,
  created_at: "2026-07-16T20:00:00Z",
  updated_at: "2026-07-16T20:00:00Z",
};

export function event(id: number, type: string, message: string): PredictionEvent {
  return {
    id,
    twitch_user_id: "42",
    session_id: null,
    type,
    message,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  };
}

export const dashboard: DashboardData = {
  user,
  presets: [preset("competitive", true), preset("custom", false)],
  activeSession: null,
  events: [],
  developmentMode: false,
};
