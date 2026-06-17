import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { renderWithProviders } from "../../test/harness";
import type { AutoPredictionPreset } from "../../types";
import { PresetCard } from "./PresetCard";

vi.mock("../../lib/api", () => ({
  api: { savePreset: vi.fn() },
}));

const savePresetMock = vi.mocked(api.savePreset);

const competitive: AutoPredictionPreset = {
  id: 1,
  twitch_user_id: "u1",
  game_mode: "competitive",
  enabled: 1,
  title_template: "Will {streamer} win?",
  outcome_a: "Yes",
  outcome_b: "No",
  prediction_window: 120,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  savePresetMock.mockReset();
  savePresetMock.mockResolvedValue({ ok: true, preset: competitive });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PresetCard", () => {
  it("shows the preset's current values", () => {
    renderWithProviders(<PresetCard preset={competitive} />);

    expect(screen.getByLabelText(/Prediction title/i)).toHaveValue("Will {streamer} win?");
    expect(screen.getByLabelText(/Outcome A/i)).toHaveValue("Yes");
    expect(screen.getByLabelText(/Outcome B/i)).toHaveValue("No");
  });

  it("saves edited values mapped to the API's camelCase input", async () => {
    renderWithProviders(<PresetCard preset={competitive} />);

    const title = screen.getByLabelText(/Prediction title/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Clutch?");
    await userEvent.click(screen.getByRole("button", { name: /Save preset/i }));

    await waitFor(() => expect(savePresetMock).toHaveBeenCalledTimes(1));
    expect(savePresetMock).toHaveBeenCalledWith("competitive", {
      enabled: true,
      titleTemplate: "Clutch?",
      outcomeA: "Yes",
      outcomeB: "No",
      predictionWindow: 120,
    });
  });

  it("surfaces a server error as a toast", async () => {
    savePresetMock.mockRejectedValue(new Error("Title too long."));
    renderWithProviders(<PresetCard preset={competitive} />);

    await userEvent.click(screen.getByRole("button", { name: /Save preset/i }));

    expect(await screen.findByText("Title too long.")).toBeInTheDocument();
  });
});
