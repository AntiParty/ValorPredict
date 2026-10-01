import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as login } from "../api/login.js";
import { BASE, REQUIRED_SCOPES, SECRET, captureConsole, startLogin, stubEnv } from "./helpers.js";

beforeEach(() => stubEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/login", () => {
  it("sends the browser to Twitch with the right parameters", async () => {
    const { response, location } = await startLogin();
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://id.twitch.tv/oauth2/authorize");

    const q = location.searchParams;
    expect(q.get("client_id")).toBe("test-client-id");
    expect(q.get("redirect_uri")).toBe(`${BASE}/api/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")?.split(" ")).toEqual(REQUIRED_SCOPES);
    expect(q.get("force_verify")).toBe("true");
    expect(q.get("state")).toBeTruthy();
  });

  it("ties the state sent to Twitch to a cookie in the same browser", async () => {
    const { state, setCookie } = await startLogin();
    expect(setCookie).toContain(`=${state}.`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("uses a fresh state every time", async () => {
    const first = await startLogin();
    const second = await startLogin();
    expect(first.state).not.toBe(second.state);
  });

  it("never puts the client secret in the redirect", async () => {
    const { response } = await startLogin();
    expect(response.headers.get("location")).not.toContain(SECRET);
  });

  it("is not cacheable", async () => {
    const { response } = await startLogin();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("shows a friendly page, and logs only the variable name, when misconfigured", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "");
    const logged = captureConsole();
    const response = await login(new Request(`${BASE}/api/login`));
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(logged()).toContain("TWITCH_CLIENT_ID");
    expect(logged()).not.toContain(SECRET);
  });
});
