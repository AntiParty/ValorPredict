import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "./api";
import { App } from "./App";
import type { MeResponse } from "./types";

vi.mock("./api", () => ({
  companionApi: { getMe: vi.fn() },
}));

vi.mock("./components/MonitorSection", () => ({
  MonitorSection: () => <div>Monitor workspace</div>,
}));

vi.mock("./components/predictions/PredictionsDashboard", () => ({
  PredictionsDashboard: () => <div>Prediction workspace</div>,
}));

const connectedMe: MeResponse = {
  configured: true,
  redirectUri: "http://localhost:3000/auth/twitch/callback",
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
};

describe("application bootstrap", () => {
  beforeEach(() => {
    vi.mocked(companionApi.getMe).mockReset();
  });

  it("shows recovery instead of onboarding when bootstrap fails", async () => {
    vi.mocked(companionApi.getMe).mockRejectedValue(new Error("IPC unavailable"));

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "ValorPredict couldn't start" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Create your Twitch app" }),
    ).not.toBeInTheDocument();
  });

  it("retries bootstrap from the recovery screen", async () => {
    vi.mocked(companionApi.getMe)
      .mockRejectedValueOnce(new Error("IPC unavailable"))
      .mockResolvedValueOnce(connectedMe);

    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    expect(await screen.findByText("test_streamer")).toBeVisible();
    expect(companionApi.getMe).toHaveBeenCalledTimes(2);
  });
});
