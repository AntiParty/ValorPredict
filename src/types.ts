export interface User {
  id: number;
  twitch_user_id: string;
  twitch_login: string;
  twitch_display_name: string;
  twitch_profile_image_url: string | null;
  public_showcase_enabled: number;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  local_api_key_hash: string | null;
  local_api_key_created_at: string | null;
  created_at: string;
  updated_at: string;
}

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

export type ValorantGameMode = "competitive" | "custom";

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

export type AutoPredictionSettings = Omit<AutoPredictionPreset, "game_mode">;

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
  outcome_a_id: string | null;
  outcome_b_id: string | null;
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

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
}

export interface TwitchUserResponse {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchPredictionResponse {
  id: string;
  title: string;
  status: string;
  outcomes: Array<{
    id: string;
    title: string;
    channel_points?: number;
  }>;
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

export interface DuoMember {
  riotId: string;
  name: string;
}

export interface DuoPartySnapshot {
  twitch_user_id: string;
  in_party: number;
  members_json: string;
  updated_at: string;
}
