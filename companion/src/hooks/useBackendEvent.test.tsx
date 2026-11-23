import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitBackendEvent, listenerCount, resetBackendEvents } from "../test/tauriEvents";
import { useBackendEvent } from "./useBackendEvent";

vi.mock("@tauri-apps/api/event", () => import("../test/tauriEvents").then((m) => m.eventModule));

afterEach(resetBackendEvents);

describe("useBackendEvent", () => {
  it("passes the payload to the latest handler", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handler }) => useBackendEvent("status-changed", handler), {
      initialProps: { handler: first },
    });
    await act(async () => undefined);

    rerender({ handler: second });
    act(() => emitBackendEvent("status-changed", { monitoring: true }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ monitoring: true });
  });

  it("ignores other events and detaches on unmount", async () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useBackendEvent("logs-changed", handler));
    await act(async () => undefined);
    expect(listenerCount("logs-changed")).toBe(1);

    act(() => emitBackendEvent("dashboard-changed"));
    expect(handler).not.toHaveBeenCalled();

    unmount();
    expect(listenerCount("logs-changed")).toBe(0);
  });

  it("detaches when disabled and re-attaches when enabled again", async () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useBackendEvent("logs-changed", handler, enabled),
      { initialProps: { enabled: false } },
    );
    await act(async () => undefined);
    expect(listenerCount("logs-changed")).toBe(0);

    rerender({ enabled: true });
    await act(async () => undefined);
    expect(listenerCount("logs-changed")).toBe(1);
  });

  it("cleans up a subscription that resolves after unmount", async () => {
    const { unmount } = renderHook(() => useBackendEvent("logs-changed", vi.fn()));
    unmount();
    await act(async () => undefined);
    expect(listenerCount("logs-changed")).toBe(0);
  });
});
