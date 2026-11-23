import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitBackendEvent, resetBackendEvents } from "../test/tauriEvents";
import { SAFETY_REFRESH_MS, useBackendResource } from "./useBackendResource";

vi.mock("@tauri-apps/api/event", () => import("../test/tauriEvents").then((m) => m.eventModule));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetBackendEvents();
});

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useBackendResource", () => {
  it("fetches once on mount and does not poll every few seconds", async () => {
    const fetcher = vi.fn(async () => "v1");
    const { result } = renderHook(() => useBackendResource(fetcher, "dashboard-changed", true));
    await flush();

    expect(result.current.data).toBe("v1");
    await act(() => vi.advanceTimersByTimeAsync(SAFETY_REFRESH_MS - 1000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-reads on a payload-less event", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    const { result } = renderHook(() => useBackendResource(fetcher, "dashboard-changed", true));
    await flush();

    act(() => emitBackendEvent("dashboard-changed", null));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("v2");
  });

  it("applies an event payload directly without another fetch", async () => {
    const fetcher = vi.fn(async () => "v1");
    const { result } = renderHook(() => useBackendResource(fetcher, "status-changed", true));
    await flush();

    act(() => emitBackendEvent("status-changed", "pushed"));

    expect(result.current.data).toBe("pushed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does one safety refresh per minute while visible", async () => {
    const fetcher = vi.fn(async () => "v");
    renderHook(() => useBackendResource(fetcher, "dashboard-changed", true));
    await flush();

    await act(() => vi.advanceTimersByTimeAsync(SAFETY_REFRESH_MS));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(SAFETY_REFRESH_MS));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does nothing while hidden and catches up on reveal", async () => {
    const fetcher = vi.fn(async () => "v");
    const { rerender } = renderHook(
      ({ visible }) => useBackendResource(fetcher, "dashboard-changed", visible),
      { initialProps: { visible: false } },
    );
    await flush();

    act(() => emitBackendEvent("dashboard-changed", null));
    await act(() => vi.advanceTimersByTimeAsync(SAFETY_REFRESH_MS * 2));
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ visible: true });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest result when an older request finishes late", async () => {
    let releaseSlow!: (value: string) => void;
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseSlow = resolve)))
      .mockResolvedValueOnce("fresh");
    const { result } = renderHook(() => useBackendResource(fetcher, "dashboard-changed", true));
    await flush();

    act(() => emitBackendEvent("dashboard-changed", null));
    await flush();
    expect(result.current.data).toBe("fresh");

    await act(async () => releaseSlow("stale"));
    expect(result.current.data).toBe("fresh");
  });

  it("reports a failed load and clears it on the next success", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce("offline").mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useBackendResource(fetcher, "dashboard-changed", true));
    await flush();
    expect(result.current.error).toBe("offline");

    act(() => emitBackendEvent("dashboard-changed", null));
    await flush();
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("ok");
  });
});
