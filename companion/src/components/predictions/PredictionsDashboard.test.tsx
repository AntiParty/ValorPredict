import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../../api";
import { dashboard, event, preset } from "../../test/fixtures";
import type { DashboardData } from "../../types";
import { PredictionsDashboard } from "./PredictionsDashboard";

vi.mock("../../api", () => ({
  companionApi: { savePreset: vi.fn(), simulateMatchStart: vi.fn() },
}));

function renderDashboard(data: DashboardData | null = dashboard, error: string | null = null) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<PredictionsDashboard data={data} error={error} refresh={refresh} />);
  return refresh;
}

const withCompetitive = (enabled: boolean): DashboardData => ({
  ...dashboard,
  presets: [preset("competitive", enabled), preset("custom", false)],
});

describe("prediction presets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows each preset's title with the streamer's login filled in", () => {
    renderDashboard();

    expect(screen.getAllByText("Will test_streamer win this match?")).toHaveLength(2);
    expect(screen.queryByText(/\{streamer\}/)).toBeNull();
  });

  it("drops the enabled count and the kicker labels", () => {
    renderDashboard();

    expect(screen.queryByText(/\d\/2 enabled/)).toBeNull();
    expect(screen.queryByText("Companion status")).toBeNull();
    expect(screen.getByText("Competitive")).toBeVisible();
    expect(screen.getByText("Custom")).toBeVisible();
  });

  it("toggles a preset from its row and saves it", async () => {
    vi.mocked(companionApi.savePreset).mockResolvedValue(preset("custom", true));
    const refresh = renderDashboard();

    await userEvent.click(screen.getByRole("checkbox", { name: "Custom preset" }));

    expect(companionApi.savePreset).toHaveBeenCalledWith(
      "custom",
      expect.objectContaining({ enabled: true, titleTemplate: "Will {streamer} win this match?" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("puts the switch back and says why when a toggle fails to save", async () => {
    vi.mocked(companionApi.savePreset).mockRejectedValue("database is locked");
    renderDashboard();

    const toggle = screen.getByRole("checkbox", { name: "Custom preset" });
    await userEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
    expect(toggle).not.toBeChecked();
  });

  it("keeps the raw template in the editor, without a second toggle", async () => {
    renderDashboard();

    await userEvent.click(screen.getByRole("button", { name: "Edit Competitive preset" }));

    expect(screen.getByLabelText(/Prediction title/)).toHaveValue("Will {streamer} win this match?");
    expect(screen.getByText("{streamer}")).toBeVisible();
    // Only the other preset's row switch remains: the editor has no toggle of its own.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByRole("checkbox", { name: "Competitive preset" })).toBeNull();
    expect(screen.queryByText("Competitive mode")).toBeNull();
  });

  it("closes the editor on a good save and keeps it open on a failed one", async () => {
    vi.mocked(companionApi.savePreset)
      .mockRejectedValueOnce("offline")
      .mockResolvedValueOnce(preset("competitive", true));
    renderDashboard();

    await userEvent.click(screen.getByRole("button", { name: "Edit Competitive preset" }));
    await userEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText(/Prediction title/)).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(await screen.findByText("Competitive preset saved.")).toBeVisible();
    expect(screen.queryByLabelText(/Prediction title/)).toBeNull();
  });
});

describe("test and activity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is collapsed, has no polling slider and no settings calls", async () => {
    renderDashboard({ ...dashboard, events: [event(1, "prediction_created", "Opened")] });

    expect(screen.getByText("Recent activity")).not.toBeVisible();
    expect(screen.queryByRole("slider")).toBeNull();
    await userEvent.click(screen.getByText("Test & activity"));
    expect(screen.getByText("Recent activity")).toBeVisible();
    expect(screen.queryByText(/polling/i)).toBeNull();
  });

  it("gives failed resolve/cancel actions a friendly title", async () => {
    renderDashboard({
      ...dashboard,
      events: [event(2, "prediction_action_error", "Twitch said no")],
    });
    await userEvent.click(screen.getByText("Test & activity"));

    expect(screen.getByText("Couldn't update prediction")).toBeVisible();
    expect(screen.queryByText("prediction action error")).toBeNull();
  });

  it("shows event times relative, with the full date in the tooltip", async () => {
    const recent = event(1, "prediction_created", "Opened");
    renderDashboard({ ...dashboard, events: [recent] });
    await userEvent.click(screen.getByText("Test & activity"));

    const time = within(screen.getByRole("list")).getByText("5 min ago");
    expect(time).toHaveAttribute("title", new Date(recent.created_at).toLocaleString());
  });

  it("does not offer a ready test action when Competitive is disabled", async () => {
    renderDashboard(withCompetitive(false));
    await userEvent.click(screen.getByText("Test & activity"));

    expect(screen.getByRole("button", { name: "Enable Competitive to test" })).toBeDisabled();
    expect(screen.getByText(/enable your Competitive preset/i)).toBeVisible();
  });

  it("sends a test prediction and shows the result, which clears itself", async () => {
    vi.mocked(companionApi.simulateMatchStart).mockResolvedValue({
      ok: true,
      action: "x",
      message: "Test prediction sent.",
    });
    const refresh = renderDashboard();
    await userEvent.click(screen.getByText("Test & activity"));

    await userEvent.click(screen.getByRole("button", { name: "Send test prediction" }));

    expect(companionApi.simulateMatchStart).toHaveBeenCalledWith("competitive");
    expect(await screen.findByRole("status")).toHaveTextContent("Test prediction sent.");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a failed load as an alert", () => {
    renderDashboard(dashboard, "backend unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("backend unavailable");
  });

  it("explains while the first load is pending or failed", () => {
    const { unmount } = render(
      <PredictionsDashboard data={null} error={null} refresh={vi.fn()} />,
    );
    expect(screen.getByText("Loading your presets…")).toBeVisible();
    unmount();
    render(<PredictionsDashboard data={null} error="nope" refresh={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
  });
});
