import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUCCESS_NOTICE_MS, useNotice } from "./useNotice";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useNotice", () => {
  it("clears a success notice after 4 seconds", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showSuccess("Saved."));
    expect(result.current.notice).toEqual({ kind: "success", message: "Saved." });

    act(() => vi.advanceTimersByTime(SUCCESS_NOTICE_MS - 1));
    expect(result.current.notice).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.notice).toBeNull();
  });

  it("keeps an error until the next action clears it", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showError("Nope."));

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.notice).toEqual({ kind: "error", message: "Nope." });

    act(() => result.current.clear());
    expect(result.current.notice).toBeNull();
  });

  it("does not let an old success timer clear a newer error", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showSuccess("Saved."));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.showError("Then it failed."));

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.notice?.kind).toBe("error");
  });
});
