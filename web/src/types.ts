// Frontend mirrors of the JSON the Express API returns. Kept in sync with
// the backend src/types.ts shapes that cross the wire.

export type ValorantGameMode = "competitive" | "custom";

export interface SafeUser {
  id: number;
  twitch_user_id: string;
  twitch_login: string;
  twitch_display_name: string;
  twitch_profile_image_url: string | null;
  public_showcase_enabled: boolean;
  token_expires_at: string;
  has_local_api_key: boolean;
  local_api_key_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicStats {
  connectedStreamers: number;
  predictionsRun: number;
  channelPointsWagered: number;
}

export interface PublicStreamer {
  twitch_login: string;
  twitch_display_name: string;
  twitch_profile_image_url: string | null;
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

export interface DuoConfig {
  twitch_user_id: string;
  enabled: number;
  public_token: string;
  template: string;
  fallback_text: string;
  updated_at: string;
}

export interface DuoShoutout {
  id: number;
  twitch_user_id: string;
  riot_id: string;
  display: string;
}

export interface FlashMessage {
  kind: "success" | "error";
  message: string;
}

export interface LocalApiKeyReveal {
  apiKey: string;
  createdAt: string;
}

export interface MeResponse {
  user: SafeUser | null;
  flash: FlashMessage | null;
}

export interface PublicResponse {
  stats: PublicStats;
  streamers: PublicStreamer[];
}

export interface DashboardData {
  user: SafeUser;
  presets: AutoPredictionPreset[];
  activeSession: PredictionSession | null;
  events: PredictionEvent[];
  localApiKeyReveal: LocalApiKeyReveal | null;
  duo: {
    config: DuoConfig;
    shoutouts: DuoShoutout[];
    url: string;
  };
  developmentMode: boolean;
}
