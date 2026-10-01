import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "../api/callback.js";
import { unseal } from "../lib/seal.js";
import {
  BASE,
  SEAL_KEY,
  SECRET,
  callbackRequest,
  captureConsole,
  mockTwitch,
  startLogin,
  stubEnv,
  tokenReply,
} from "./helpers.js";

beforeEach(() => stubEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function signIn(authCode = "twitch-auth-code") {
  const { state, cookie } = await startLogin();
  return callbackRequest({ code: authCode, state }, cookie);
}

describe("GET /api/callback: success", () => {
  it("exchanges the code with the secret and shows a masked copy page", async () => {
    const calls = mockTwitch(() => tokenReply());
    const logged = captureConsole();

    const response = await callback(await signIn());
    const html = await response.text();

    // The Twitch exchange used the secret and the same redirect_uri as /login.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://id.twitch.tv/oauth2/token");
    expect(calls[0]?.params.get("client_secret")).toBe(SECRET);
    expect(calls[0]?.params.get("client_id")).toBe("test-client-id");
    expect(calls[0]?.params.get("code")).toBe("twitch-auth-code");
    expect(calls[0]?.params.get("grant_type")).toBe("authorization_code");
    expect(calls[0]?.params.get("redirect_uri")).toBe(`${BASE}/api/callback`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");

    // Nothing sensitive in the page or the logs.
    for (const secret of [SECRET, "access-AAA", "refresh-BBB"]) {
      expect(html).not.toContain(secret);
      expect(logged()).not.toContain(secret);
    }
  });

  it("never renders the code as visible text", async () => {
    mockTwitch(() => tokenReply());
    const html = await (await callback(await signIn())).text();

    const code = /let code = "(vp1_[A-Za-z0-9_-]+)";/.exec(html)?.[1];
    expect(code).toBeTruthy();
    // It appears exactly once: inside the inline script, nowhere in the markup.
    expect(html.split(code as string)).toHaveLength(2);
    const markupOnly = html.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(markupOnly).not.toMatch(/vp1_[A-Za-z0-9_-]{20,}/);
    expect(markupOnly).toContain("vp1_•••");
    expect(html).toContain("Copy connection code");
  });

  it("hands over a code that opens to the tokens Twitch issued", async () => {
    mockTwitch(() => tokenReply());
    const html = await (await callback(await signIn())).text();
    const code = /let code = "(vp1_[A-Za-z0-9_-]+)";/.exec(html)?.[1] as string;

    const tokens = await unseal(code, SEAL_KEY);
    expect(tokens.at).toBe("access-AAA");
    expect(tokens.rt).toBe("refresh-BBB");
    expect(tokens.exp).toBe(14400);
  });

  it("locks the page down", async () => {
    mockTwitch(() => tokenReply());
    const response = await callback(await signIn());
    const html = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";

    const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("uses a different nonce on every response", async () => {
    mockTwitch(() => tokenReply());
    const first = await callback(await signIn());
    const second = await callback(await signIn());
    const nonceOf = (r: Response) => /nonce-([A-Za-z0-9_-]+)/.exec(r.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it("clears the login cookie", async () => {
    mockTwitch(() => tokenReply());
    const response = await callback(await signIn());
    expect(response.headers.getSetCookie().join("\n")).toMatch(/__Host-vp_state=;.*Max-Age=0/);
  });
});

describe("GET /api/callback: refusals", () => {
  it("refuses a callback with no matching login cookie, without calling Twitch", async () => {
    const calls = mockTwitch(() => tokenReply());
    const { state } = await startLogin();

    const response = await callback(callbackRequest({ code: "x", state }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("expired");
    expect(calls).toHaveLength(0);
  });

  it("refuses a state that belongs to a different login", async () => {
    const calls = mockTwitch(() => tokenReply());
    const mine = await startLogin();
    const theirs = await startLogin();

    const response = await callback(callbackRequest({ code: "x", state: theirs.state }, mine.cookie));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("explains a cancelled sign-in", async () => {
    const calls = mockTwitch(() => tokenReply());
    const { state, cookie } = await startLogin();

    const response = await callback(
      callbackRequest({ error: "access_denied", error_description: "The user denied you access", state }, cookie),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Connection cancelled");
    expect(calls).toHaveLength(0);
  });

  it("does not echo query parameters back into the page", async () => {
    mockTwitch(() => tokenReply());
    const { state, cookie } = await startLogin();
    const response = await callback(
      callbackRequest({ error: "<script>alert(1)</script>", error_description: "<img src=x onerror=alert(1)>", state }, cookie),
    );
    const html = await response.text();
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onerror");
  });

  it("refuses a missing or oversized authorization code", async () => {
    const calls = mockTwitch(() => tokenReply());
    const { state, cookie } = await startLogin();
    expect((await callback(callbackRequest({ state }, cookie))).status).toBe(400);
    expect((await callback(callbackRequest({ state, code: "c".repeat(600) }, cookie))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("reports Twitch rejecting the code", async () => {
    mockTwitch(() => Response.json({ message: "Invalid authorization code" }, { status: 400 }));
    const response = await callback(await signIn());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("rejected");
  });

  it("reports Twitch being down as a 502 and says to retry", async () => {
    mockTwitch(() => new Response("oops", { status: 503 }));
    const response = await callback(await signIn());
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("try again in a moment");
  });

  it("survives a network failure talking to Twitch", async () => {
    mockTwitch(() => {
      throw new TypeError("fetch failed");
    });
    expect((await callback(await signIn())).status).toBe(502);
  });

  it("survives a malformed token response", async () => {
    mockTwitch(() => Response.json({ access_token: "only-this" }));
    expect((await callback(await signIn())).status).toBe(502);
  });

  it("refuses a sign-in that lacks the permissions the app needs", async () => {
    mockTwitch(() => tokenReply({ scope: ["channel:read:predictions"] }));
    const response = await callback(await signIn());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing permissions");
  });

  it("clears the login cookie on failures too, and never leaks the secret", async () => {
    mockTwitch(() => Response.json({}, { status: 400 }));
    const logged = captureConsole();
    const response = await callback(await signIn());
    expect(response.headers.getSetCookie().join("\n")).toContain("Max-Age=0");
    expect(await response.text()).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });
});
