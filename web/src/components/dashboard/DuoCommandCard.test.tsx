import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { renderWithProviders } from "../../test/harness";
import type { DashboardData } from "../../types";
import { DuoCommandCard } from "./DuoCommandCard";

vi.mock("../../lib/api", () => ({
  api: { saveDuo: vi.fn(), regenerateDuo: vi.fn() },
}));

const saveDuoMock = vi.mocked(api.saveDuo);
const regenerateMock = vi.mocked(api.regenerateDuo);

const duo: DashboardData["duo"] = {
  config: {
    twitch_user_id: "u1",
    enabled: 1,
    public_token: "tok",
    template: "Queued with {names}",
    fallback_text: "Solo today",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  shoutouts: [{ id: 1, twitch_user_id: "u1", riot_id: "Ace#NA1", display: "the legend" }],
  url: "https://vap.example/duo/tok",
};

beforeEach(() => {
  saveDuoMock.mockReset().mockResolvedValue({
    ok: true,
    duo: { config: duo.config, shoutouts: duo.shoutouts },
  });
  regenerateMock.mockReset().mockResolvedValue({
    ok: true,
    publicToken: "tok2",
    url: "https://vap.example/duo/tok2",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DuoCommandCard", () => {
  it("shows the current public URL", () => {
    renderWithProviders(<DuoCommandCard duo={duo} />);
    expect(screen.getByDisplayValue("https://vap.example/duo/tok")).toBeInTheDocument();
  });

  it("saves the duo settings including existing shoutouts", async () => {
    renderWithProviders(<DuoCommandCard duo={duo} />);

    await userEvent.click(screen.getByRole("button", { name: /Save duo command/i }));

    await waitFor(() => expect(saveDuoMock).toHaveBeenCalledTimes(1));
    expect(saveDuoMock).toHaveBeenCalledWith({
      enabled: true,
      template: "Queued with {names}",
      fallbackText: "Solo today",
      shoutouts: [{ riotId: "Ace#NA1", display: "the legend" }],
    });
  });

  it("regenerates the public URL", async () => {
    renderWithProviders(<DuoCommandCard duo={duo} />);

    await userEvent.click(screen.getByRole("button", { name: /Regenerate URL/i }));

    await waitFor(() => expect(regenerateMock).toHaveBeenCalledTimes(1));
  });
});
