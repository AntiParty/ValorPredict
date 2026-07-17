import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../../api";
import type { DashboardData, PredictionSession } from "../../types";
import { PredictionsDashboard } from "./PredictionsDashboard";

vi.mock("../../api", () => ({
  companionApi: {
    getDashboard: vi.fn(),
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    savePreset: vi.fn(),
    simulateMatchStart: vi.fn(),
    resolvePrediction: vi.fn(),
    cancelPrediction: vi.fn(),
  },
}));

vi.mock("../../hooks/useWindowVisible", () => ({
  useWindowVisible: () => true,
}));

const dashboard: DashboardData = {
  user: {
    id: 1,
    twitch_user_id: "42",
    twitch_login: "test_streamer",
    twitch_display_name: "Test Streamer",
    twitch_profile_image_url: null,
    token_expires_at: "2099-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  presets: [
    {
      id: 1,
      twitch_user_id: "42",
      game_mode: "competitive",
      enabled: 0,
      title_template: "Will {streamer} win?",
      outcome_a: "Win",
      outcome_b: "Loss",
      prediction_window: 120,
      win_outcome: "A",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
  activeSession: null,
  events: [],
  developmentMode: false,
};

const liveSession: PredictionSession = {
  id: 7,
  twitch_user_id: "42",
  status: "prediction_open",
  twitch_prediction_id: "prediction-7",
  outcome_a_label: "Win",
  outcome_b_label: "Loss",
  title: "Will test_streamer win?",
  started_at: "2026-07-16T20:00:00Z",
  resolved_at: null,
  result: null,
  channel_points_wagered: 0,
  created_at: "2026-07-16T20:00:00Z",
  updated_at: "2026-07-16T20:00:00Z",
};

async function openMore() {
  fireEvent.click(await screen.findByText("More"));
}

describe("prediction dashboard safeguards", () => {
  beforeEach(() => {
    vi.mocked(companionApi.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(companionApi.loadSettings).mockResolvedValue({
      pollIntervalSeconds: 15,
      monitoringEnabled: false,
    });
    vi.mocked(companionApi.saveSettings).mockResolvedValue({
      pollIntervalSeconds: 25,
      monitoringEnabled: false,
    });
  });

  it("does not offer a ready test action when Competitive is disabled", async () => {
    render(<PredictionsDashboard />);
    await openMore();

    const button = await screen.findByRole("button", {
      name: "Enable Competitive to test",
    });
    expect(button).toBeDisabled();
    expect(screen.getByText(/enable your Competitive preset/i)).toBeVisible();
  });

  it("persists one settings value after a slider gesture", async () => {
    render(<PredictionsDashboard />);
    await openMore();
    const slider = await screen.findByRole("slider", {
      name: "Detection polling interval",
    });

    fireEvent.change(slider, { target: { value: "20" } });
    fireEvent.change(slider, { target: { value: "25" } });
    expect(companionApi.saveSettings).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    await waitFor(() => {
      expect(companionApi.saveSettings).toHaveBeenCalledTimes(1);
      expect(companionApi.saveSettings).toHaveBeenCalledWith(25);
    });
  });

  it("marks the draft value unsaved when persistence fails", async () => {
    vi.mocked(companionApi.saveSettings).mockRejectedValue(new Error("disk full"));
    render(<PredictionsDashboard />);
    await openMore();
    const slider = await screen.findByRole("slider", {
      name: "Detection polling interval",
    });

    fireEvent.change(slider, { target: { value: "25" } });
    fireEvent.pointerUp(slider);

    expect(await screen.findByText(/25s not saved/i)).toBeVisible();
    expect(slider).toHaveAttribute("aria-invalid", "true");
  });

  it("does not render an empty current-prediction card", async () => {
    render(<PredictionsDashboard />);

    await screen.findByText("Prediction presets");
    expect(screen.queryByText("Current prediction")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting for a match")).not.toBeInTheDocument();
  });

  it("keeps live prediction resolution controls visible", async () => {
    vi.mocked(companionApi.getDashboard).mockResolvedValue({
      ...dashboard,
      activeSession: liveSession,
    });
    render(<PredictionsDashboard />);

    expect(await screen.findByText("Current prediction")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Resolve.*Win/i }),
    ).toBeVisible();
  });

  it("keeps occasional tools inside More", async () => {
    render(<PredictionsDashboard />);

    const more = await screen.findByText("More");
    expect(screen.getByText("Recent prediction activity")).not.toBeVisible();
    fireEvent.click(more);
    expect(screen.getByText("Recent prediction activity")).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Detection polling interval" }),
    ).toBeVisible();
  });
});
