import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisiblePolling } from "./useVisiblePolling";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useVisiblePolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes immediately and never overlaps a slow request", async () => {
    const pending = deferred();
    const refresh = vi.fn(() => pending.promise);

    renderHook(() => useVisiblePolling(refresh, 3000, true));
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does no work while hidden and refreshes immediately on reveal", () => {
    const refresh = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ visible }) => useVisiblePolling(refresh, 3000, visible),
      { initialProps: { visible: false } },
    );

    expect(refresh).not.toHaveBeenCalled();
    rerender({ visible: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
