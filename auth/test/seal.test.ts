import { describe, expect, it } from "vitest";
import { CODE_MAX_AGE_S, CODE_PREFIX, CodeError, seal, unseal, type SealedTokens } from "../lib/seal.js";
import { SEAL_KEY } from "./helpers.js";

const NOW = 1_800_000_000;
const payload: SealedTokens = { at: "access-AAA", rt: "refresh-BBB", exp: 14400, iat: NOW };

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodeError) return error.reason;
    throw error;
  }
  return "no error";
};

describe("connection code sealing", () => {
  it("round-trips the tokens", async () => {
    const code = await seal(payload, SEAL_KEY);
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(await unseal(code, SEAL_KEY, NOW + 5)).toEqual(payload);
  });

  it("does not expose the tokens, and differs every time", async () => {
    const a = await seal(payload, SEAL_KEY);
    const b = await seal(payload, SEAL_KEY);
    expect(a).not.toBe(b);
    const readable = Buffer.from(a.slice(CODE_PREFIX.length), "base64url").toString("latin1");
    expect(readable).not.toContain("access-AAA");
    expect(readable).not.toContain("refresh-BBB");
  });

  it("rejects a code with one altered character", async () => {
    const code = await seal(payload, SEAL_KEY);
    const middle = Math.floor(code.length / 2);
    const swapped = code[middle] === "A" ? "B" : "A";
    const tampered = code.slice(0, middle) + swapped + code.slice(middle + 1);
    expect(await reasonOf(unseal(tampered, SEAL_KEY, NOW))).toBe("invalid");
  });

  it("rejects a code sealed with a different key", async () => {
    const otherKey = Buffer.alloc(32, 0x99).toString("base64");
    const code = await seal(payload, otherKey);
    expect(await reasonOf(unseal(code, SEAL_KEY, NOW))).toBe("invalid");
  });

  it("rejects things that are not connection codes", async () => {
    expect(await reasonOf(unseal("hello", SEAL_KEY, NOW))).toBe("format");
    expect(await reasonOf(unseal("vp1_", SEAL_KEY, NOW))).toBe("format");
    expect(await reasonOf(unseal("vp1_!!not-base64!!", SEAL_KEY, NOW))).toBe("format");
    expect(await reasonOf(unseal("vp1_" + "A".repeat(10), SEAL_KEY, NOW))).toBe("format");
    expect(await reasonOf(unseal("vp1_" + "A".repeat(5000), SEAL_KEY, NOW))).toBe("format");
  });

  it("is valid for exactly ten minutes", async () => {
    const code = await seal(payload, SEAL_KEY);
    expect(CODE_MAX_AGE_S).toBe(600);
    await expect(unseal(code, SEAL_KEY, NOW + 600)).resolves.toEqual(payload);
    expect(await reasonOf(unseal(code, SEAL_KEY, NOW + 601))).toBe("expired");
  });

  it("tolerates a little clock skew but not a code from the future", async () => {
    const code = await seal(payload, SEAL_KEY);
    await expect(unseal(code, SEAL_KEY, NOW - 30)).resolves.toEqual(payload);
    expect(await reasonOf(unseal(code, SEAL_KEY, NOW - 61))).toBe("expired");
  });
});
