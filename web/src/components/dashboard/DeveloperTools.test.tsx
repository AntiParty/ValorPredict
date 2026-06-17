import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { renderWithProviders } from "../../test/harness";
import type { AutoPredictionPreset } from "../../types";
import { DeveloperTools } from "./DeveloperTools";

vi.mock("../../lib/api", () => ({
  api: { simulateMatchStart: vi.fn() },
}));

const simulateMock = vi.mocked(api.simulateMatchStart);

function preset(
  game_mode: AutoPredictionPreset["game_mode"],
  enabled: number,
): AutoPredictionPreset {
  return {
    id: 1,
    twitch_user_id: "u1",
    game_mode,
    enabled,
    title_template: "t",
    outcome_a: "a",
    outcome_b: "b",
    prediction_window: 120,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  simulateMock.mockReset().mockResolvedValue({
    ok: true,
    action: "created",
    message: "Simulated.",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DeveloperTools", () => {
  it("simulates a competitive match start", async () => {
    renderWithProviders(
      <DeveloperTools competitive={preset("competitive", 1)} custom={preset("custom", 1)} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Simulate Competitive Match/i }),
    );

    await waitFor(() => expect(simulateMock).toHaveBeenCalledWith("competitive"));
  });

  it("disables simulation for a preset that is turned off", () => {
    renderWithProviders(
      <DeveloperTools competitive={preset("competitive", 0)} custom={preset("custom", 1)} />,
    );

    expect(
      screen.getByRole("button", { name: /Simulate Competitive Match/i }),
    ).toBeDisabled();
  });
});
