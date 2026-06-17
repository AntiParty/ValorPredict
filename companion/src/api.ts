import { invoke } from "@tauri-apps/api/core";

import type {
  BackendResponse,
  DetectionStatus,
  SettingsView,
} from "./types";

export const companionApi = {
  loadSettings: () => invoke<SettingsView>("load_settings"),
  saveSettings: (
    backendUrl: string,
    localApiKey: string,
    pollIntervalSeconds: number,
  ) =>
    invoke<SettingsView>("save_settings", {
      backendUrl,
      localApiKey,
      pollIntervalSeconds,
    }),
  testConnection: () =>
    invoke<BackendResponse>("test_backend_connection"),
  getStatus: () => invoke<DetectionStatus>("get_status"),
  startMonitoring: () => invoke<DetectionStatus>("start_monitoring"),
  stopMonitoring: () => invoke<DetectionStatus>("stop_monitoring"),
  simulatePregame: () => invoke<BackendResponse>("simulate_pregame"),
  simulateCompetitiveCurrentGame: () =>
    invoke<BackendResponse>("simulate_competitive_current_game"),
  simulateCustomCurrentGame: () =>
    invoke<BackendResponse>("simulate_custom_current_game"),
  resetCooldown: () => invoke<DetectionStatus>("reset_cooldown"),
  clearLogs: () => invoke<DetectionStatus>("clear_logs"),
};
