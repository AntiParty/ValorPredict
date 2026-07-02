import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";

function mockFetch(response: {
  ok: boolean;
  status?: number;
  body?: unknown;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("sends credentials on GET and returns the parsed body", async () => {
    const fetchMock = mockFetch({
      ok: true,
      body: { user: null, flash: null, configured: false },
    });

    const result = await api.me();

    expect(result).toEqual({ user: null, flash: null, configured: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
  });

  it("adds the CSRF header and JSON body on mutations", async () => {
    const fetchMock = mockFetch({ ok: true, body: { ok: true, configured: true } });

    await api.saveTwitchCredentials("abc", "xyz");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings/twitch");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers["X-Requested-With"]).toBe("fetch");
    expect(init.headers["Content-Type"]).toMatch(/application\/json/);
    expect(JSON.parse(init.body)).toEqual({ clientId: "abc", clientSecret: "xyz" });
  });

  it("throws ApiError carrying the server message on a non-ok response", async () => {
    mockFetch({ ok: false, status: 400, body: { ok: false, error: "Nope." } });

    await expect(api.resolvePrediction("A")).rejects.toThrow(ApiError);
    await expect(api.resolvePrediction("A")).rejects.toThrow("Nope.");
  });
});
