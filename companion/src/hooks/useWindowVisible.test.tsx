import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitBackendEvent, listenerCount, resetBackendEvents } from "../test/tauriEvents";
import { useWindowVisible, WindowVisibleProvider } from "./useWindowVisible";

vi.mock("@tauri-apps/api/event", () => import("../test/tauriEvents").then((m) => m.eventModule));

afterEach(resetBackendEvents);

function Consumer({ name }: { name: string }) {
  return <p>{`${name}: ${useWindowVisible() ? "visible" : "hidden"}`}</p>;
}

describe("window visibility", () => {
  it("registers one listener for every consumer and shares its value", async () => {
    render(
      <WindowVisibleProvider>
        <Consumer name="a" />
        <Consumer name="b" />
      </WindowVisibleProvider>,
    );
    await act(async () => undefined);

    expect(listenerCount("app:visibility")).toBe(1);
    expect(screen.getByText("a: visible")).toBeVisible();

    act(() => emitBackendEvent("app:visibility", false));
    expect(screen.getByText("a: hidden")).toBeVisible();
    expect(screen.getByText("b: hidden")).toBeVisible();
  });

  it("defaults to visible without a provider", () => {
    render(<Consumer name="solo" />);
    expect(screen.getByText("solo: visible")).toBeVisible();
  });
});
