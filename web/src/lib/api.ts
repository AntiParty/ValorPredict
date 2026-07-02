import type {
  AutoPredictionPreset,
  DashboardData,
  MeResponse,
  ValorantGameMode,
} from "../types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, credentials: "include", headers };

  if (method !== "GET") {
    // The server requires this header; a cross-site page can't set it without a
    // CORS preflight (which we don't grant), so it guards localhost mutations.
    headers["X-Requested-With"] = "fetch";
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }

  const response = await fetch(path, init);
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }

  return data as T;
}

export interface PresetInput {
  enabled: boolean;
  titleTemplate: string;
  outcomeA: string;
  outcomeB: string;
  predictionWindow: number;
}

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  dashboard: () => request<DashboardData>("GET", "/api/dashboard"),

  getTwitchSettings: () =>
    request<{ configured: boolean }>("GET", "/api/settings/twitch"),

  saveTwitchCredentials: (clientId: string, clientSecret: string) =>
    request<{ ok: true; configured: boolean }>("POST", "/api/settings/twitch", {
      clientId,
      clientSecret,
    }),

  savePreset: (gameMode: ValorantGameMode, input: PresetInput) =>
    request<{ ok: true; preset: AutoPredictionPreset }>(
      "POST",
      `/api/presets/${gameMode}`,
      input,
    ),

  resolvePrediction: (winner: "A" | "B") =>
    request<{ ok: true; message: string }>("POST", "/api/predictions/resolve", {
      winner,
    }),

  cancelPrediction: () =>
    request<{ ok: true; message: string }>("POST", "/api/predictions/cancel"),

  simulateMatchStart: (gameMode: ValorantGameMode) =>
    request<{ ok: true; action: string; message: string }>(
      "POST",
      `/api/predictions/simulate-match-start/${gameMode}`,
    ),
};
