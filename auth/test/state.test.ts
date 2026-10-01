import { describe, expect, it } from "vitest";
import { getEnv } from "../lib/env.js";
import { clearStateCookie, createState, verifyState } from "../lib/state.js";
import { TEST_ENV } from "./helpers.js";

const env = getEnv(TEST_ENV);
const cookieOf = (setCookie: string) => setCookie.split(";")[0] ?? "";

describe("login state", () => {
  it("accepts the state it issued, from the browser it was issued to", async () => {
    const { state, setCookie } = await createState(env);
    expect(await verifyState(env, cookieOf(setCookie), state)).toBe(true);
  });

  it("finds the cookie among others", async () => {
    const { state, setCookie } = await createState(env);
    const header = `theme=dark; ${cookieOf(setCookie)}; other=1`;
    expect(await verifyState(env, header, state)).toBe(true);
  });

  it("rejects when the cookie or the state is missing", async () => {
    const { state, setCookie } = await createState(env);
    expect(await verifyState(env, null, state)).toBe(false);
    expect(await verifyState(env, "theme=dark", state)).toBe(false);
    expect(await verifyState(env, cookieOf(setCookie), null)).toBe(false);
    expect(await verifyState(env, cookieOf(setCookie), "")).toBe(false);
  });

  it("rejects a state from someone else's login", async () => {
    const mine = await createState(env);
    const theirs = await createState(env);
    expect(await verifyState(env, cookieOf(mine.setCookie), theirs.state)).toBe(false);
  });

  it("rejects a forged or altered cookie", async () => {
    const { state, setCookie } = await createState(env);
    const [name, value] = cookieOf(setCookie).split("=") as [string, string];
    const [, signature] = value.split(".") as [string, string];

    // Attacker picks their own state and reuses a signature.
    expect(await verifyState(env, `${name}=attacker-state.${signature}`, "attacker-state")).toBe(false);
    // Signature with one character changed.
    const bent = signature.slice(0, 5) + (signature[5] === "A" ? "B" : "A") + signature.slice(6);
    expect(await verifyState(env, `${name}=${state}.${bent}`, state)).toBe(false);
    // No signature at all.
    expect(await verifyState(env, `${name}=${state}`, state)).toBe(false);
    expect(await verifyState(env, `${name}=${state}.`, state)).toBe(false);
  });

  it("rejects a cookie signed with a different key", async () => {
    const other = getEnv({ ...TEST_ENV, STATE_SIGNING_KEY: Buffer.alloc(32, 0x77).toString("base64") });
    const { state, setCookie } = await createState(other);
    expect(await verifyState(env, cookieOf(setCookie), state)).toBe(false);
  });

  it("sets a locked-down cookie on https", async () => {
    const { setCookie } = await createState(env);
    expect(setCookie.startsWith("__Host-vp_state=")).toBe(true);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=600"]) {
      expect(setCookie).toContain(attribute);
    }
    expect(setCookie).not.toContain("Domain");
  });

  it("works over plain http for localhost development", async () => {
    const local = getEnv({ ...TEST_ENV, PUBLIC_BASE_URL: "http://localhost:3000" });
    const { state, setCookie } = await createState(local);
    expect(setCookie.startsWith("vp_state=")).toBe(true);
    expect(setCookie).not.toContain("Secure");
    expect(await verifyState(local, cookieOf(setCookie), state)).toBe(true);
  });

  it("can expire the cookie", () => {
    const cleared = clearStateCookie(env);
    expect(cleared.startsWith("__Host-vp_state=;")).toBe(true);
    expect(cleared).toContain("Max-Age=0");
  });
});
