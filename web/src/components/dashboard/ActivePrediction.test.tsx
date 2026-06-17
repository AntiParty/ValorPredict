import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { renderWithProviders } from "../../test/harness";
import type { PredictionSession } from "../../types";
import { ActivePrediction } from "./ActivePrediction";

vi.mock("../../lib/api", () => ({
  api: { resolvePrediction: vi.fn(), cancelPrediction: vi.fn() },
}));

const resolveMock = vi.mocked(api.resolvePrediction);
const cancelMock = vi.mocked(api.cancelPrediction);

const liveSession = {
  id: 1,
  status: "prediction_open",
  title: "Will ace win?",
  started_at: "2026-01-01T00:00:00.000Z",
} as PredictionSession;

beforeEach(() => {
  resolveMock.mockReset().mockResolvedValue({ ok: true, message: "Resolved." });
  cancelMock.mockReset().mockResolvedValue({ ok: true, message: "Cancelled." });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ActivePrediction", () => {
  it("shows a waiting state when there is no live prediction", () => {
    renderWithProviders(<ActivePrediction />);

    expect(screen.getByText(/Waiting for a match/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resolve A/i })).not.toBeInTheDocument();
  });

  it("resolves the live prediction for the chosen side", async () => {
    renderWithProviders(<ActivePrediction activeSession={liveSession} />);

    await userEvent.click(screen.getByRole("button", { name: /Resolve B/i }));

    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith("B"));
  });

  it("cancels the live prediction", async () => {
    renderWithProviders(<ActivePrediction activeSession={liveSession} />);

    await userEvent.click(screen.getByRole("button", { name: /Cancel prediction/i }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
  });
});
