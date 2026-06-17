export interface AppConfig {
  twitchClientId: string;
  twitchClientSecret: string;
  twitchRedirectUri: string;
  sessionSecret: string;
  databasePath: string;
  port: number;
}

type Environment = Record<string, string | undefined>;

function requireValue(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function clampPredictionWindow(value: number): number {
  if (!Number.isFinite(value)) return 90;
  return Math.min(1800, Math.max(30, Math.round(value)));
}

export function loadConfig(environment: Environment = process.env): AppConfig {
  const port = Number(environment.PORT ?? 3000);

  return {
    twitchClientId: requireValue(environment, "TWITCH_CLIENT_ID"),
    twitchClientSecret: requireValue(environment, "TWITCH_CLIENT_SECRET"),
    twitchRedirectUri: requireValue(environment, "TWITCH_REDIRECT_URI"),
    sessionSecret: requireValue(environment, "SESSION_SECRET"),
    databasePath:
      environment.DATABASE_PATH?.trim() ||
      "./data/valorant-auto-predictions.sqlite",
    port: Number.isInteger(port) && port > 0 ? port : 3000,
  };
}
