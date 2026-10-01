import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as refresh } from "../api/refresh.js";
import { SECRET, captureConsole, mockTwitch, post, stubEnv, tokenReply } from "./helpers.js";

beforeEach(() => stubEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = (refresh_token: unknown, headers?: Record<string, string>) =>
  refresh(post("/api/refresh", { refresh_token }, headers));

describe("POST /api/refresh", () => {
  it("trades a refresh token for new tokens using the secret", async () => {
    const calls = mockTwitch(() =>
      tokenReply({ access_token: "access-NEW", refresh_token: "refresh-NEW", expires_in: 13000 }),
    );
    const logged = captureConsole();

    const response = await call("refresh-OLD");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    // Only the three fields the app needs; no scope, token_type or anything else.
    expect(await response.json()).toEqual({
      access_token: "access-NEW",
      refresh_token: "refresh-NEW",
      expires_in: 13000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://id.twitch.tv/oauth2/token");
    expect(calls[0]?.params.get("grant_type")).toBe("refresh_token");
    expect(calls[0]?.params.get("refresh_token")).toBe("refresh-OLD");
    expect(calls[0]?.params.get("client_secret")).toBe(SECRET);
    expect(logged()).not.toContain("refresh-NEW");
    expect(logged()).not.toContain("refresh-OLD");
    expect(logged()).not.toContain(SECRET);
  });

  it("encodes tokens that contain special characters", async () => {
    const calls = mockTwitch(() => tokenReply());
    await call("abc+def/ghi=jkl&mno");
    expect(calls[0]?.params.get("refresh_token")).toBe("abc+def/ghi=jkl&mno");
  });

  it("never includes the secret in a response", async () => {
    mockTwitch(() => tokenReply());
    expect(await (await call("refresh-OLD")).text()).not.toContain(SECRET);
  });

  it("tells the app to sign in again when Twitch refuses the token", async () => {
    for (const status of [400, 401]) {
      mockTwitch(() => Response.json({ status, message: "Invalid refresh token" }, { status }));
      const response = await call("refresh-OLD");
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "reauth" });
    }
  });

  it("tells the app to retry later when Twitch is unavailable", async () => {
    for (const status of [429, 500, 503]) {
      mockTwitch(() => new Response("nope", { status }));
      const response = await call("refresh-OLD");
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "upstream" });
    }
  });

  it("copes with network failures and malformed replies", async () => {
    mockTwitch(() => {
      throw new TypeError("fetch failed");
    });
    expect((await call("refresh-OLD")).status).toBe(502);

    mockTwitch(() => new Response("<html>", { status: 200 }));
    expect((await call("refresh-OLD")).status).toBe(502);

    mockTwitch(() => Response.json({ access_token: "a" }));
    expect((await call("refresh-OLD")).status).toBe(502);
  });

  it("rejects bad input without calling Twitch", async () => {
    const calls = mockTwitch(() => tokenReply());
    for (const bad of [undefined, null, "", 42, "has space", "tab\there", "new\nline", "x".repeat(513), ["a"], {}]) {
      const response = await call(bad);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid" });
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects requests that don't identify as the app", async () => {
    const calls = mockTwitch(() => tokenReply());
    expect((await call("refresh-OLD", { "user-agent": "Mozilla/5.0" })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects bodies that are not small JSON", async () => {
    mockTwitch(() => tokenReply());
    expect((await refresh(post("/api/refresh", "nope"))).status).toBe(400);
    expect((await refresh(post("/api/refresh", { refresh_token: "x".repeat(4000) }))).status).toBe(413);
    expect(
      (await refresh(post("/api/refresh", "a=b", { "content-type": "text/plain" }))).status,
    ).toBe(415);
  });

  it("reports a misconfigured server", async () => {
    vi.stubEnv("TWITCH_CLIENT_SECRET", "");
    const response = await call("refresh-OLD");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_misconfigured" });
  });
});
