import { describe, expect, it } from "vitest";
import { BodyError, readJsonBody } from "../lib/http.js";
import { BASE } from "./helpers.js";

const req = (body: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BodyError) return error.code;
    throw error;
  }
  return "ok";
};

describe("readJsonBody", () => {
  it("parses small JSON", async () => {
    await expect(readJsonBody(req('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonBody(req('{"a":1}', { "content-type": "application/json; charset=utf-8" }))).resolves.toEqual({
      a: 1,
    });
  });

  it("stops reading once the limit is passed, even without a Content-Length", async () => {
    expect(await codeOf(readJsonBody(req(JSON.stringify({ pad: "x".repeat(3000) }))))).toBe("too_large");
    expect(await codeOf(readJsonBody(req(JSON.stringify({ pad: "x".repeat(100) })), 50))).toBe("too_large");
  });

  it("refuses a declared length over the limit before reading", async () => {
    expect(await codeOf(readJsonBody(req("{}", { "content-length": "999999" })))).toBe("too_large");
  });

  it("requires a JSON content type", async () => {
    expect(await codeOf(readJsonBody(req("{}", { "content-type": "text/plain" })))).toBe("bad_type");
    expect(await codeOf(readJsonBody(new Request(`${BASE}/x`, { method: "POST", body: "{}" })))).toBe("bad_type");
  });

  it("rejects invalid JSON and empty bodies", async () => {
    expect(await codeOf(readJsonBody(req("{oops")))).toBe("bad_json");
    expect(
      await codeOf(readJsonBody(new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json" } }))),
    ).toBe("bad_json");
  });
});
