// Local development server. Runs the real route handlers on plain Node so the
// whole flow can be tried without a Vercel account. It is not deployed.
//
//   npm run dev:fake    Twitch is simulated: no Twitch app or credentials needed.
//   npm run dev:local   Real Twitch. Reads .env.local (see .env.example).
//
// Then open http://localhost:3001/api/login

import { randomBytes } from "node:crypto";
import http from "node:http";
import { GET as callback } from "../api/callback.js";
import { GET as login } from "../api/login.js";
import { POST as redeem } from "../api/redeem.js";
import { POST as refresh } from "../api/refresh.js";
import { getEnv } from "../lib/env.js";

type Handler = (request: Request) => Response | Promise<Response>;

const routes: Record<string, Partial<Record<string, Handler>>> = {
  "/api/login": { GET: login },
  "/api/callback": { GET: callback },
  "/api/redeem": { POST: redeem },
  "/api/refresh": { POST: refresh },
};

const fake = process.argv.includes("--fake");
// Not 3000: the desktop app's own sign-in listener uses that port.
const port = Number(process.env.PORT ?? 3001);

/**
 * Stand-in for Twitch's token endpoint. Send the refresh token "revoked" to /api/refresh
 * to see the sign-in-again path, or "outage" to see the Twitch-is-down path.
 */
function installFakeTwitch(): void {
  let issued = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith("https://id.twitch.tv/oauth2/token")) return realFetch(input, init);

    const params = new URLSearchParams(String(init?.body ?? ""));
    if (params.get("grant_type") === "refresh_token") {
      const old = params.get("refresh_token");
      if (old === "revoked") {
        return Response.json({ status: 400, message: "Invalid refresh token" }, { status: 400 });
      }
      if (old === "outage") return new Response("Service Unavailable", { status: 503 });
    }
    issued += 1;
    return Response.json({
      access_token: `fake-access-${issued}`,
      refresh_token: `fake-refresh-${issued}`,
      expires_in: 14400,
      scope: ["channel:manage:predictions", "channel:read:predictions"],
      token_type: "bearer",
    });
  }) as typeof fetch;
}

/** In fake mode, skip Twitch's approval screen: go straight back to the callback. */
function fakeApproval(response: Response): Response {
  const location = response.headers.get("location") ?? "";
  if (response.status !== 302 || !location.startsWith("https://id.twitch.tv/oauth2/authorize")) {
    return response;
  }
  const state = new URL(location).searchParams.get("state") ?? "";
  response.headers.set("location", `/api/callback?code=fake-auth-code&state=${encodeURIComponent(state)}`);
  return response;
}

if (fake) {
  const key = () => randomBytes(32).toString("base64");
  Object.assign(process.env, {
    TWITCH_CLIENT_ID: "fake-client-id",
    TWITCH_CLIENT_SECRET: "fake-client-secret",
    PUBLIC_BASE_URL: `http://localhost:${port}`,
    CODE_SEAL_KEY: key(),
    STATE_SIGNING_KEY: key(),
  });
  installFakeTwitch();
}

try {
  const env = getEnv();
  if (new URL(env.baseUrl).port !== String(port)) {
    console.warn(
      `\nWarning: PUBLIC_BASE_URL is ${env.baseUrl} but this server listens on port ${port}.` +
        `\nTwitch will redirect to PUBLIC_BASE_URL, so make them match (or set PORT).\n`,
    );
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : "Invalid configuration"}`);
  console.error('Copy .env.example to .env.local and fill it in, or run "npm run dev:fake".\n');
  process.exit(1);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const route = routes[url.pathname];
    const handler = route?.[req.method ?? ""];
    let response: Response;

    if (!route) {
      response = new Response("Not found", { status: 404 });
    } else if (!handler) {
      response = new Response("Method not allowed", {
        status: 405,
        headers: { Allow: Object.keys(route).join(", ") },
      });
    } else {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const v of value) headers.append(name, v);
        else if (value !== undefined) headers.set(name, value);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const hasBody = chunks.length > 0 && req.method !== "GET" && req.method !== "HEAD";

      try {
        response = await handler(
          new Request(url, {
            method: req.method,
            headers,
            body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
          }),
        );
      } catch (error) {
        console.error("[dev] handler crashed:", error instanceof Error ? error.message : "unknown error");
        response = new Response("Internal error", { status: 500 });
      }
      if (fake && url.pathname === "/api/login") response = fakeApproval(response);
    }

    const out: Record<string, string | string[]> = {};
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") out[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) out["set-cookie"] = cookies;
    res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));

    // Path only: the callback's query string carries Twitch's sign-in code.
    console.log(`${req.method} ${url.pathname} -> ${response.status}`);
  })
  .listen(port, () => {
    console.log(`\nValorPredict auth service (${fake ? "SIMULATED Twitch" : "real Twitch"})`);
    console.log(`Open  http://localhost:${port}/api/login\n`);
  });
