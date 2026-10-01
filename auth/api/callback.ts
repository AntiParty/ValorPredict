// GET /api/callback
// Twitch sends the browser back here with a one-time `code`. We check the login
// was started by this browser, trade the code for tokens using the Client
// Secret, then show a page where the user copies a sealed connection code.
// Nothing is stored: the tokens live only inside the sealed code.

import { loadEnv } from "../lib/http.js";
import { errorPageResponse, htmlResponse, makeNonce, renderCodePage } from "../lib/page.js";
import { CODE_MAX_AGE_S, seal } from "../lib/seal.js";
import { clearStateCookie, verifyState } from "../lib/state.js";
import { exchangeCode, TwitchError } from "../lib/twitch.js";

const MAX_AUTH_CODE_LENGTH = 512;

export async function GET(request: Request): Promise<Response> {
  const env = loadEnv(() =>
    errorPageResponse(
      "Sign-in is unavailable",
      "The ValorPredict sign-in service isn't configured correctly. Please let the developer know.",
      500,
    ),
  );
  if (env instanceof Response) return env;

  const clear = [clearStateCookie(env)];
  const fail = (title: string, message: string, status = 400) =>
    errorPageResponse(title, message, status, clear);

  const params = new URL(request.url).searchParams;

  if (params.get("error")) {
    return params.get("error") === "access_denied"
      ? fail("Connection cancelled", "You chose not to give ValorPredict access to your Twitch account.")
      : fail("Twitch couldn't sign you in", "Twitch reported a problem with the sign-in.");
  }

  const stateOk = await verifyState(env, request.headers.get("cookie"), params.get("state"));
  if (!stateOk) {
    return fail(
      "This sign-in link has expired",
      "It may be too old, or it was opened in a different browser than the one you started from.",
    );
  }

  const authCode = params.get("code");
  if (!authCode || authCode.length > MAX_AUTH_CODE_LENGTH) {
    return fail("Twitch didn't return a sign-in code", "Something went wrong during sign-in.");
  }

  let tokens;
  try {
    tokens = await exchangeCode(env, authCode);
  } catch (error) {
    if (error instanceof TwitchError && error.kind === "scope") {
      return fail(
        "Missing permissions",
        "ValorPredict needs permission to manage Channel Points Predictions on your channel.",
      );
    }
    if (error instanceof TwitchError && error.kind === "rejected") {
      return fail("Twitch rejected the sign-in", "The sign-in code was not accepted. It may have been used already.");
    }
    return fail("Twitch isn't responding", "We couldn't reach Twitch just now. Please try again in a moment.", 502);
  }

  const code = await seal(
    {
      at: tokens.access_token,
      rt: tokens.refresh_token,
      exp: tokens.expires_in,
      iat: Math.floor(Date.now() / 1000),
    },
    env.sealKey,
  );

  const nonce = makeNonce();
  return htmlResponse(renderCodePage({ code, remainingSeconds: CODE_MAX_AGE_S, nonce }), nonce, 200, clear);
}
