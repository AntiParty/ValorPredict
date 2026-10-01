// POST /api/redeem   { "code": "vp1_…" }
// The app trades the connection code the user pasted for the underlying tokens.
// Only this service can open the code, and only within CODE_MAX_AGE_S of issue.

import { bodyErrorResponse, errorJson, json, loadEnv, readJsonBody, requireClient } from "../lib/http.js";
import { CodeError, unseal } from "../lib/seal.js";

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

  const raw = (body as { code?: unknown } | null)?.code;
  if (typeof raw !== "string" || raw.trim() === "") return errorJson("invalid", 400);

  try {
    const sealed = await unseal(raw.trim(), env.sealKey);
    // The code can be redeemed up to 10 minutes after the access token was
    // issued, so report the lifetime that is actually left.
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - sealed.iat);
    return json({
      access_token: sealed.at,
      refresh_token: sealed.rt,
      expires_in: Math.max(0, sealed.exp - elapsed),
    });
  } catch (error) {
    if (error instanceof CodeError) {
      return error.reason === "expired" ? errorJson("expired", 410) : errorJson("invalid", 400);
    }
    return errorJson("server_error", 500);
  }
}
