import { invoke } from "@tauri-apps/api/core";

import type {
  AutoPredictionPreset,
  BackendResponse,
  DashboardData,
  DetectionStatus,
  MeResponse,
  PresetGameMode,
  PresetInput,
  SafeUser,
  SettingsView,
} from "./types";

export const companionApi = {
  // --- Companion detection / monitoring ---
  loadSettings: () => invoke<SettingsView>("load_settings"),
  saveSettings: (pollIntervalSeconds: number) =>
    invoke<SettingsView>("save_settings", { pollIntervalSeconds }),
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

  // --- Predictions (local backend) ---
  getMe: () => invoke<MeResponse>("get_me"),
  getDashboard: () => invoke<DashboardData>("get_dashboard"),
  getTwitchSettings: () =>
    invoke<{ configured: boolean; redirectUri: string }>("get_twitch_settings"),
  saveTwitchCredentials: (clientId: string, clientSecret: string) =>
    invoke<{ ok: true; configured: true }>("save_twitch_credentials", {
      clientId,
      clientSecret,
    }),
  savePreset: (gameMode: PresetGameMode, input: PresetInput) =>
    invoke<AutoPredictionPreset>("save_preset", {
      gameMode,
      enabled: input.enabled,
      titleTemplate: input.titleTemplate,
      outcomeA: input.outcomeA,
      outcomeB: input.outcomeB,
      predictionWindow: input.predictionWindow,
      winOutcome: input.winOutcome,
    }),
  resolvePrediction: (winner: "A" | "B") =>
    invoke<{ ok: true; message: string }>("resolve_prediction", { winner }),
  cancelPrediction: () =>
    invoke<{ ok: true; message: string }>("cancel_prediction"),
  simulateMatchStart: (gameMode: PresetGameMode) =>
    invoke<{ ok: true; action: string; message: string }>(
      "simulate_match_start",
      { gameMode },
    ),
  connectTwitch: () => invoke<SafeUser>("connect_twitch"),
};
