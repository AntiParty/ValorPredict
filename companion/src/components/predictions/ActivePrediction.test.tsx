import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../../api";
import { liveSession } from "../../test/fixtures";
import { ActivePrediction } from "./ActivePrediction";

vi.mock("../../api", () => ({
  companionApi: { resolvePrediction: vi.fn(), cancelPrediction: vi.fn() },
}));

describe("live prediction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the title, a relative start time and both outcomes", () => {
    render(<ActivePrediction session={liveSession} onChanged={vi.fn()} />);

    expect(screen.getByText("Will test_streamer win this match?")).toBeVisible();
    expect(screen.getByText("2 min ago")).toBeVisible();
    expect(screen.getByRole("button", { name: "Resolve: Win" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Resolve: Loss" })).toBeVisible();
    expect(screen.queryByText("Idle")).toBeNull();
    expect(screen.queryByText("Waiting for a match")).toBeNull();
  });

  it("keeps the full start date in the tooltip", () => {
    render(<ActivePrediction session={liveSession} onChanged={vi.fn()} />);
    expect(screen.getByText("2 min ago")).toHaveAttribute(
      "title",
      new Date(liveSession.started_at!).toLocaleString(),
    );
  });

  it("makes Cancel a text-style danger button, not a solid block", () => {
    render(<ActivePrediction session={liveSession} onChanged={vi.fn()} />);
    const cancel = screen.getByRole("button", { name: "Cancel prediction" });
    expect(cancel).toHaveClass("button", "danger");
    expect(cancel).not.toHaveClass("wide", "primary");
  });

  it("resolves the chosen side and refreshes", async () => {
    vi.mocked(companionApi.resolvePrediction).mockResolvedValue({ ok: true, message: "ok" });
    const onChanged = vi.fn();
    render(<ActivePrediction session={liveSession} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: "Resolve: Loss" }));

    expect(companionApi.resolvePrediction).toHaveBeenCalledWith("B");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("cancels and refreshes", async () => {
    vi.mocked(companionApi.cancelPrediction).mockResolvedValue({ ok: true, message: "ok" });
    const onChanged = vi.fn();
    render(<ActivePrediction session={liveSession} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel prediction" }));

    expect(companionApi.cancelPrediction).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the error on screen when Twitch refuses", async () => {
    vi.mocked(companionApi.resolvePrediction).mockRejectedValue("Twitch said no");
    const onChanged = vi.fn();
    render(<ActivePrediction session={liveSession} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: "Resolve: Win" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Twitch said no");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
