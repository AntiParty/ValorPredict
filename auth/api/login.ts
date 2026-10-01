// GET /api/login
// The app opens this in the user's browser. We remember who started the login
// (signed cookie) and bounce them to Twitch's approval screen.

import { baseHeaders, loadEnv } from "../lib/http.js";
import { errorPageResponse } from "../lib/page.js";
import { createState } from "../lib/state.js";
import { buildAuthorizeUrl } from "../lib/twitch.js";

export async function GET(_request: Request): Promise<Response> {
  const env = loadEnv(() =>
    errorPageResponse(
      "Sign-in is unavailable",
      "The ValorPredict sign-in service isn't configured correctly. Please let the developer know.",
      500,
    ),
  );
  if (env instanceof Response) return env;

  const { state, setCookie } = await createState(env);
  const headers = baseHeaders({ Location: buildAuthorizeUrl(env, state) });
  headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
}
