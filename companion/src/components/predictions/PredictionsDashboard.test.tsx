import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../../api";
import type { DashboardData } from "../../types";
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

    const button = await screen.findByRole("button", {
      name: "Enable Competitive to test",
    });
    expect(button).toBeDisabled();
    expect(screen.getByText(/enable your Competitive preset/i)).toBeVisible();
  });

  it("persists one settings value after a slider gesture", async () => {
    render(<PredictionsDashboard />);
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
    const slider = await screen.findByRole("slider", {
      name: "Detection polling interval",
    });

    fireEvent.change(slider, { target: { value: "25" } });
    fireEvent.pointerUp(slider);

    expect(await screen.findByText(/25s not saved/i)).toBeVisible();
    expect(slider).toHaveAttribute("aria-invalid", "true");
  });
});
