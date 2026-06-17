export type ValorantLocalState =
  | "unknown"
  | "not_running"
  | "menus"
  | "pre_game"
  | "current_game"
  | "post_game";

export type ValorantGameMode = "competitive" | "custom" | "unknown";

export interface SettingsView {
  backendUrl: string;
  localApiKeyMasked: string;
  hasLocalApiKey: boolean;
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
  backendConnected: boolean;
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
  duoEnabled: boolean;
  duoStatus: string;
  logs: LogEntry[];
}
