// Frontend mirrors of the JSON the Rust backend returns. Kept in sync with the
// shapes in companion/core/src.

export type ValorantGameMode = "competitive" | "custom";

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
  game_mode: ValorantGameMode;
  enabled: number;
  title_template: string;
  outcome_a: string;
  outcome_b: string;
  prediction_window: number;
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

export interface FlashMessage {
  kind: "success" | "error";
  message: string;
}

export interface MeResponse {
  user: SafeUser | null;
  flash: FlashMessage | null;
  configured: boolean;
}

export interface DashboardData {
  user: SafeUser;
  presets: AutoPredictionPreset[];
  activeSession: PredictionSession | null;
  events: PredictionEvent[];
  developmentMode: boolean;
}
