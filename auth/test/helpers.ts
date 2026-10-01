import { vi } from "vitest";
import { GET as login } from "../api/login.js";

export const SECRET = "super-secret-value-do-not-leak";
export const BASE = "https://auth.example.test";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");
export const SEAL_KEY = key(0x11);
export const STATE_KEY = key(0x22);

export const TEST_ENV: Record<string, string> = {
  TWITCH_CLIENT_ID: "test-client-id",
  TWITCH_CLIENT_SECRET: SECRET,
  PUBLIC_BASE_URL: BASE,
  CODE_SEAL_KEY: SEAL_KEY,
  STATE_SIGNING_KEY: STATE_KEY,
};

export function stubEnv(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...TEST_ENV, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

export interface TwitchCall {
  url: string;
  params: URLSearchParams;
}

/** Replace global fetch with a fake Twitch token endpoint; returns the recorded calls. */
export function mockTwitch(respond: (call: TwitchCall) => Response | Promise<Response>): TwitchCall[] {
  const calls: TwitchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const call = { url: String(url), params: new URLSearchParams(String(init?.body ?? "")) };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}

export const REQUIRED_SCOPES = ["channel:manage:predictions", "channel:read:predictions"];

export function tokenReply(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    access_token: "access-AAA",
    refresh_token: "refresh-BBB",
    expires_in: 14400,
    scope: REQUIRED_SCOPES,
    token_type: "bearer",
    ...extra,
  });
}

/** Capture everything written to the console so tests can prove nothing sensitive was logged. */
export function captureConsole(): () => string {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  return () => JSON.stringify(spies.map((spy) => spy.mock.calls));
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "ValorPredict/test", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Run /api/login the way a browser would and return the pieces the callback needs. */
export async function startLogin() {
  const response = await login(new Request(`${BASE}/api/login`));
  const location = new URL(response.headers.get("location") ?? "");
  const state = location.searchParams.get("state") ?? "";
  const setCookie = response.headers.getSetCookie()[0] ?? "";
  return { response, location, state, setCookie, cookie: setCookie.split(";")[0] ?? "" };
}

export function callbackRequest(query: Record<string, string>, cookie?: string): Request {
  const url = new URL(`${BASE}/api/callback`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return new Request(url, { headers: cookie ? { cookie } : {} });
}
