export type ValorantLocalState =
  | "unknown"
  | "not_running"
  | "menus"
  | "pre_game"
  | "current_game"
  | "post_game";

export type ValorantGameMode = "competitive" | "custom" | "unknown";

export interface SettingsView {
  pollIntervalSeconds: number;
  monitoringEnabled: boolean;
}

export interface BackendResponse {
  ok: boolean;
  action: string;
  message: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface DetectionStatus {
  riotLockfileFound: boolean;
  riotClientRunning: boolean;
  valorantRunning: boolean;
  region: string;
  shard: string;
  localState: ValorantLocalState;
  gameMode: ValorantGameMode;
  confidence: number;
  lastMatchIdHash: string | null;
  cooldownRemainingSeconds: number;
  lastBackendResponse: string;
  monitoring: boolean;
  logs: LogEntry[];
}

// --- Predictions (ported from the website, served locally by the Rust core) ---
// These mirror the snake_case JSON the vap_core database structs serialize.

export type PresetGameMode = "competitive" | "custom";

export interface SafeUser {
  id: number;
  twitch_user_id: string;
  twitch_login: string;
  twitch_display_name: string;
  twitch_profile_image_url: string | null;
  token_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface AutoPredictionPreset {
  id: number;
  twitch_user_id: string;
  game_mode: PresetGameMode;
  enabled: number;
  title_template: string;
  outcome_a: string;
  outcome_b: string;
  prediction_window: number;
  win_outcome: string;
  created_at: string;
  updated_at: string;
}

export type PredictionSessionStatus =
  | "creating"
  | "prediction_open"
  | "resolved"
  | "cancelled"
  | "failed";

export interface PredictionSession {
  id: number;
  twitch_user_id: string;
  status: PredictionSessionStatus;
  twitch_prediction_id: string | null;
  title: string;
  started_at: string | null;
  resolved_at: string | null;
  result: string | null;
  channel_points_wagered: number;
  created_at: string;
  updated_at: string;
}

export interface PredictionEvent {
  id: number;
  twitch_user_id: string;
  session_id: number | null;
  type: string;
  message: string;
  created_at: string;
}

export interface MeResponse {
  user: SafeUser | null;
  configured: boolean;
  redirectUri: string;
}

export interface DashboardData {
  user: SafeUser;
  presets: AutoPredictionPreset[];
  activeSession: PredictionSession | null;
  events: PredictionEvent[];
  developmentMode: boolean;
}

export interface PresetInput {
  enabled: boolean;
  titleTemplate: string;
  outcomeA: string;
  outcomeB: string;
  predictionWindow: number;
  winOutcome: "A" | "B";
}
