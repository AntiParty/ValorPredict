import { fromB64 } from "./b64.js";

export interface Env {
  clientId: string;
  clientSecret: string;
  /** Origin of this deployment, e.g. https://auth.example.com (no trailing slash). */
  baseUrl: string;
  /** base64, 32 bytes: AES-256-GCM key for connection codes. */
  sealKey: string;
  /** base64, 32 bytes: HMAC key for the login `state` cookie. */
  stateKey: string;
  isHttps: boolean;
}

/**
 * Thrown when the deployment is misconfigured. The message names the variable
 * but never includes its value.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  const need = (name: string): string => {
    const value = source[name]?.trim();
    if (!value) throw new ConfigError(`Missing environment variable ${name}`);
    return value;
  };

  const rawBase = need("PUBLIC_BASE_URL");
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    throw new ConfigError("PUBLIC_BASE_URL is not a valid URL");
  }
  const isHttps = url.protocol === "https:";
  if (!isHttps && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigError("PUBLIC_BASE_URL must be https (http is only allowed for localhost)");
  }

  const key = (name: string): string => {
    const value = need(name);
    if (fromB64(value).length !== 32) {
      throw new ConfigError(`${name} must be 32 random bytes, base64-encoded`);
    }
    return value;
  };

  return {
    clientId: need("TWITCH_CLIENT_ID"),
    clientSecret: need("TWITCH_CLIENT_SECRET"),
    baseUrl: url.origin,
    sealKey: key("CODE_SEAL_KEY"),
    stateKey: key("STATE_SIGNING_KEY"),
    isHttps,
  };
}
