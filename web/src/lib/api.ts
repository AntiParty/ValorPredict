import type {
  AutoPredictionPreset,
  DashboardData,
  DuoConfig,
  DuoShoutout,
  LocalApiKeyReveal,
  MeResponse,
  PublicResponse,
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
    // SameSite=lax already blocks cross-site cookie sends; this header is a
    // second barrier that simple cross-site HTML forms cannot set.
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

export interface DuoInput {
  enabled: boolean;
  template: string;
  fallbackText: string;
  shoutouts: Array<{ riotId: string; display: string }>;
}

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  public: () => request<PublicResponse>("GET", "/api/public"),
  dashboard: () => request<DashboardData>("GET", "/api/dashboard"),

  setShowcase: (enabled: boolean) =>
    request<{ ok: true; publicShowcaseEnabled: boolean }>(
      "POST",
      "/api/settings/public-showcase",
      { enabled },
    ),

  savePreset: (gameMode: ValorantGameMode, input: PresetInput) =>
    request<{ ok: true; preset: AutoPredictionPreset }>(
      "POST",
      `/api/presets/${gameMode}`,
      input,
    ),

  saveDuo: (input: DuoInput) =>
    request<{ ok: true; duo: { config: DuoConfig; shoutouts: DuoShoutout[] } }>(
      "POST",
      "/api/settings/duo",
      input,
    ),

  regenerateDuo: () =>
    request<{ ok: true; publicToken: string; url: string }>(
      "POST",
      "/api/settings/duo/regenerate",
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

  generateLocalKey: () =>
    request<{ ok: true } & LocalApiKeyReveal>(
      "POST",
      "/api/local/generate-key",
    ),
};
