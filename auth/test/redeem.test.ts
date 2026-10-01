import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as redeem } from "../api/redeem.js";
import { seal } from "../lib/seal.js";
import { BASE, SEAL_KEY, SECRET, captureConsole, post, stubEnv } from "./helpers.js";

beforeEach(() => stubEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const now = () => Math.floor(Date.now() / 1000);
const issue = (ageSeconds = 0, exp = 14400) =>
  seal({ at: "access-AAA", rt: "refresh-BBB", exp, iat: now() - ageSeconds }, SEAL_KEY);

describe("POST /api/redeem", () => {
  it("opens a fresh code", async () => {
    const logged = captureConsole();
    const response = await redeem(post("/api/redeem", { code: await issue() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ access_token: "access-AAA", refresh_token: "refresh-BBB", expires_in: 14400 });
    expect(logged()).not.toContain("access-AAA");
  });

  it("reports the access-token lifetime that is actually left", async () => {
    const response = await redeem(post("/api/redeem", { code: await issue(120) }));
    const { expires_in } = (await response.json()) as { expires_in: number };
    expect(expires_in).toBeGreaterThanOrEqual(14279);
    expect(expires_in).toBeLessThanOrEqual(14280);
  });

  it("never reports a negative lifetime", async () => {
    const response = await redeem(post("/api/redeem", { code: await issue(100, 30) }));
    expect(((await response.json()) as { expires_in: number }).expires_in).toBe(0);
  });

  it("ignores whitespace the clipboard may have added", async () => {
    const response = await redeem(post("/api/redeem", { code: `  ${await issue()}\r\n` }));
    expect(response.status).toBe(200);
  });

  it("rejects an expired code with a distinct error", async () => {
    const response = await redeem(post("/api/redeem", { code: await issue(601) }));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "expired" });
  });

  it("rejects altered or made-up codes", async () => {
    const code = await issue();
    const middle = Math.floor(code.length / 2);
    const altered = code.slice(0, middle) + (code[middle] === "A" ? "B" : "A") + code.slice(middle + 1);

    for (const bad of [altered, "vp1_AAAA", "hello", "access-AAA"]) {
      const response = await redeem(post("/api/redeem", { code: bad }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid" });
    }
  });

  it("rejects a missing or non-string code", async () => {
    for (const body of [{}, { code: "" }, { code: "   " }, { code: 42 }, { code: null }, [], null]) {
      expect((await redeem(post("/api/redeem", body))).status).toBe(400);
    }
  });

  it("rejects bodies that are malformed, oversized or not JSON", async () => {
    expect((await redeem(post("/api/redeem", "{not json"))).status).toBe(400);
    expect((await redeem(post("/api/redeem", { code: "x".repeat(3000) }))).status).toBe(413);
    expect(
      (await redeem(post("/api/redeem", "code=abc", { "content-type": "application/x-www-form-urlencoded" }))).status,
    ).toBe(415);
  });

  it("rejects requests that don't identify as the app", async () => {
    const code = await issue();
    expect((await redeem(post("/api/redeem", { code }, { "user-agent": "curl/8.0" }))).status).toBe(403);
    expect((await redeem(post("/api/redeem", { code }, { "user-agent": "" }))).status).toBe(403);
  });

  it("reports a misconfigured server without leaking anything", async () => {
    vi.stubEnv("CODE_SEAL_KEY", "");
    const logged = captureConsole();
    const response = await redeem(post("/api/redeem", { code: "vp1_whatever" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_misconfigured" });
    expect(logged()).toContain("CODE_SEAL_KEY");
    expect(logged()).not.toContain(SECRET);
  });

  it("only exposes POST", async () => {
    const mod = await import("../api/redeem.js");
    expect(Object.keys(mod)).toEqual(["POST"]);
    expect(BASE).toBeTruthy();
  });
});
