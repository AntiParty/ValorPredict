import { describe, expect, it } from "vitest";
import { ConfigError, getEnv } from "../lib/env.js";
import { SECRET, TEST_ENV } from "./helpers.js";

describe("configuration", () => {
  it("accepts a complete configuration and normalises the base URL", () => {
    const env = getEnv({ ...TEST_ENV, PUBLIC_BASE_URL: "https://auth.example.test/some/path/" });
    expect(env.baseUrl).toBe("https://auth.example.test");
    expect(env.isHttps).toBe(true);
    expect(env.clientId).toBe("test-client-id");
  });

  it("names a missing variable without revealing any values", () => {
    for (const name of Object.keys(TEST_ENV)) {
      const incomplete = { ...TEST_ENV };
      delete incomplete[name];
      let message = "";
      try {
        getEnv(incomplete);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        message = (error as Error).message;
      }
      expect(message).toContain(name);
      expect(message).not.toContain(SECRET);
    }
  });

  it("treats blank values as missing", () => {
    expect(() => getEnv({ ...TEST_ENV, TWITCH_CLIENT_SECRET: "   " })).toThrow(/TWITCH_CLIENT_SECRET/);
  });

  it("insists on https except for localhost", () => {
    expect(() => getEnv({ ...TEST_ENV, PUBLIC_BASE_URL: "http://auth.example.test" })).toThrow(/https/);
    expect(getEnv({ ...TEST_ENV, PUBLIC_BASE_URL: "http://localhost:3000" }).isHttps).toBe(false);
    expect(getEnv({ ...TEST_ENV, PUBLIC_BASE_URL: "http://127.0.0.1:3000" }).isHttps).toBe(false);
    expect(() => getEnv({ ...TEST_ENV, PUBLIC_BASE_URL: "not a url" })).toThrow(ConfigError);
  });

  it("requires 32-byte keys", () => {
    const short = Buffer.alloc(16, 1).toString("base64");
    expect(() => getEnv({ ...TEST_ENV, CODE_SEAL_KEY: short })).toThrow(/CODE_SEAL_KEY/);
    expect(() => getEnv({ ...TEST_ENV, STATE_SIGNING_KEY: short })).toThrow(/STATE_SIGNING_KEY/);
  });
});
