// POST /api/refresh   { "refresh_token": "…" }
// Twitch access tokens last a few hours. The app calls this to get a new pair
// without asking the user to sign in again. It is the only reason the Client
// Secret needs to live on a server: the caller must already hold a valid
// refresh token, so this endpoint can't be used to mint access out of thin air.

import { bodyErrorResponse, errorJson, json, loadEnv, readJsonBody, requireClient } from "../lib/http.js";
import { refreshTokens, TwitchError } from "../lib/twitch.js";

// Printable ASCII with no spaces; Twitch refresh tokens are short alphanumerics.
const REFRESH_TOKEN_PATTERN = /^[\x21-\x7e]{1,512}$/;

export async function POST(request: Request): Promise<Response> {
  const notClient = requireClient(request);
  if (notClient) return notClient;

  const env = loadEnv(() => errorJson("server_misconfigured", 500));
  if (env instanceof Response) return env;

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return bodyErrorResponse(error);
  }

  const token = (body as { refresh_token?: unknown } | null)?.refresh_token;
  if (typeof token !== "string" || !REFRESH_TOKEN_PATTERN.test(token)) {
    return errorJson("invalid", 400);
  }

  try {
    return json(await refreshTokens(env, token));
  } catch (error) {
    if (error instanceof TwitchError && error.kind === "rejected") {
      // Revoked, expired or otherwise unusable: the user has to sign in again.
      return errorJson("reauth", 401);
    }
    return errorJson("upstream", 502);
  }
}
