import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "./api";
import { App } from "./App";
import { emitBackendEvent, resetBackendEvents } from "./test/tauriEvents";
import { dashboard, liveSession } from "./test/fixtures";
import type { MeResponse } from "./types";

vi.mock("@tauri-apps/api/event", () => import("./test/tauriEvents").then((m) => m.eventModule));

vi.mock("./api", () => ({
  companionApi: { getMe: vi.fn(), getDashboard: vi.fn(), disconnectTwitch: vi.fn() },
}));

vi.mock("./components/Workspace", () => ({
  Workspace: ({ me }: { me: MeResponse; dashboard: unknown }) => (
    <div>Workspace{me.reauthRequired ? " (reauth)" : ""}</div>
  ),
}));

const connectedMe: MeResponse = {
  configured: true,
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  authMode: "hosted",
  hostedAvailable: true,
  reauthRequired: false,
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
    resetBackendEvents();
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

  it("renders the workspace behind an account button, without the old brand subtitle", async () => {
    vi.mocked(companionApi.getMe).mockResolvedValue(connectedMe);
    render(<App />);

    expect(await screen.findByText("Workspace")).toBeVisible();
    expect(screen.getByRole("button", { name: /test_streamer/ })).toBeVisible();
    expect(screen.queryByText(/local companion/i)).toBeNull();
  });

  it("returns to onboarding after Disconnect Twitch", async () => {
    vi.mocked(companionApi.getMe)
      .mockResolvedValueOnce(connectedMe)
      .mockResolvedValueOnce({ ...connectedMe, user: null });
    vi.mocked(companionApi.disconnectTwitch).mockResolvedValue(null);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /test_streamer/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Disconnect Twitch" }));

    expect(await screen.findByRole("button", { name: "Connect Twitch" })).toBeVisible();
    expect(screen.queryByText("Workspace")).toBeNull();
    expect(companionApi.getMe).toHaveBeenCalledTimes(2);
  });

  it("blocks Disconnect while a prediction is open", async () => {
    vi.mocked(companionApi.getMe).mockResolvedValue(connectedMe);
    vi.mocked(companionApi.getDashboard).mockResolvedValue({ ...dashboard, activeSession: liveSession });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /test_streamer/ }));

    expect(await screen.findByText("Resolve or cancel the open prediction first.")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Disconnect Twitch" })).toBeDisabled();
  });

  it("picks up a reauth change pushed by the backend", async () => {
    vi.mocked(companionApi.getMe)
      .mockResolvedValueOnce(connectedMe)
      .mockResolvedValueOnce({ ...connectedMe, reauthRequired: true });
    render(<App />);
    await screen.findByText("Workspace");

    await act(async () => {
      emitBackendEvent("dashboard-changed");
    });

    expect(await screen.findByText("Workspace (reauth)")).toBeVisible();
  });
});
