// The only place the Twitch Client Secret is used.
//
// Never log request or response bodies in this file: they contain tokens.

import type { Env } from "./env.js";

const AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const REQUEST_TIMEOUT_MS = 8000;

/** Must stay in sync with SCOPES in companion/core/src/twitch.rs. */
export const SCOPES = ["channel:manage:predictions", "channel:read:predictions"] as const;

export interface TwitchTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * - `rejected`: Twitch said no (bad/expired/revoked code or token). Retrying won't help.
 * - `upstream`: Twitch or the network failed. Retrying later may work.
 * - `scope`: sign-in worked but the granted scopes don't cover what the app needs.
 */
export type TwitchErrorKind = "rejected" | "upstream" | "scope";

export class TwitchError extends Error {
  readonly kind: TwitchErrorKind;
  constructor(kind: TwitchErrorKind) {
    super(`twitch ${kind}`);
    this.name = "TwitchError";
    this.kind = kind;
  }
}

export function redirectUri(env: Env): string {
  return `${env.baseUrl}/api/callback`;
}

export function buildAuthorizeUrl(env: Env, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    // Lets streamers who are signed into several Twitch accounts pick the right one.
    force_verify: "true",
  }).toString();
  return url.toString();
}

interface RawTokenResponse extends TwitchTokens {
  scope?: string[];
}

async function postToken(env: Env, params: Record<string, string>): Promise<RawTokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        ...params,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TwitchError("upstream");
  }

  if (response.status === 429 || response.status >= 500) throw new TwitchError("upstream");
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new TwitchError("rejected");
  }
  if (!response.ok) throw new TwitchError("upstream");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TwitchError("upstream");
  }
  const data = body as Partial<RawTokenResponse> | null;
  if (
    !data ||
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string" ||
    typeof data.expires_in !== "number"
  ) {
    throw new TwitchError("upstream");
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: Array.isArray(data.scope) ? data.scope.filter((s) => typeof s === "string") : undefined,
  };
}

export async function exchangeCode(env: Env, code: string): Promise<TwitchTokens> {
  const result = await postToken(env, {
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(env),
  });
  if (result.scope && !SCOPES.every((required) => result.scope?.includes(required))) {
    throw new TwitchError("scope");
  }
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in: result.expires_in,
  };
}

export async function refreshTokens(env: Env, refreshToken: string): Promise<TwitchTokens> {
  const result = await postToken(env, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in: result.expires_in,
  };
}
