import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../api";
import { dashboard, event, idleStatus, liveSession } from "../test/fixtures";
import { emitBackendEvent, resetBackendEvents } from "../test/tauriEvents";
import type { DashboardData, MeResponse } from "../types";
import { useDashboard } from "../hooks/useDashboard";
import { Workspace as WorkspaceView } from "./Workspace";

function Workspace({ me, onReloadMe }: { me: MeResponse; onReloadMe: () => void }) {
  return <WorkspaceView me={me} dashboard={useDashboard()} onReloadMe={onReloadMe} />;
}

vi.mock("@tauri-apps/api/event", () => import("../test/tauriEvents").then((m) => m.eventModule));
vi.mock("../api", () => ({
  companionApi: {
    getStatus: vi.fn(),
    getDashboard: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    connectTwitch: vi.fn(),
    startHostedLogin: vi.fn(),
    importConnectionCodeFromClipboard: vi.fn(),
    importConnectionCode: vi.fn(),
    getLogs: vi.fn(),
    getDetectionMetrics: vi.fn(),
  },
}));

const me: MeResponse = {
  user: dashboard.user,
  configured: true,
  redirectUri: "",
  authMode: "hosted",
  hostedAvailable: true,
  reauthRequired: false,
};

function renderWorkspace(overrides: Partial<MeResponse> = {}, data: DashboardData = dashboard) {
  vi.mocked(companionApi.getDashboard).mockResolvedValue(data);
  const onReloadMe = vi.fn();
  render(<Workspace me={{ ...me, ...overrides }} onReloadMe={onReloadMe} />);
  return onReloadMe;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBackendEvents();
  vi.mocked(companionApi.getStatus).mockResolvedValue(idleStatus);
});

describe("connected workspace", () => {
  it("says 'paused' once on the idle screen: no banner repeats the status card", async () => {
    renderWorkspace();

    await screen.findByRole("heading", { name: "Monitoring is paused" });
    await screen.findByText("Prediction presets");
    expect(screen.getAllByText(/paused/i)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /start monitoring/i })).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says 'waiting for Valorant' once while monitoring", async () => {
    vi.mocked(companionApi.getStatus).mockResolvedValue({ ...idleStatus, monitoring: true });
    renderWorkspace();

    await screen.findByRole("heading", { name: "Waiting for Valorant" });
    expect(screen.getAllByText(/waiting for valorant/i)).toHaveLength(1);
  });

  it("puts the live prediction above the status card", async () => {
    renderWorkspace({}, { ...dashboard, activeSession: liveSession });

    const live = await screen.findByRole("region", { name: "Live prediction" });
    const status = screen.getByRole("heading", { name: "Monitoring is paused" });
    expect(live.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no live card when nothing is open", async () => {
    renderWorkspace();
    await screen.findByText("Prediction presets");
    expect(screen.queryByRole("region", { name: "Live prediction" })).toBeNull();
  });

  it("shows the compact reconnect panel and a paused status card for a hosted sign-in", async () => {
    renderWorkspace({ reauthRequired: true });

    expect(
      await screen.findByRole("heading", { name: "Predictions paused: reconnect Twitch" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Reconnect your Twitch account" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Twitch" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Paste from clipboard" })).toBeVisible();
    // The long trust text belongs to onboarding only.
    expect(screen.queryByText(/never sees your Twitch password/i)).toBeNull();
  });

  it("reloads the account after the hosted reconnect succeeds", async () => {
    vi.mocked(companionApi.importConnectionCodeFromClipboard).mockResolvedValue({} as never);
    const onReloadMe = renderWorkspace({ reauthRequired: true });

    await userEvent.click(await screen.findByRole("button", { name: "Paste from clipboard" }));

    expect(onReloadMe).toHaveBeenCalledTimes(1);
  });

  it("uses the reconnect banner (not the hosted panel) for an own-app sign-in", async () => {
    vi.mocked(companionApi.connectTwitch).mockResolvedValue(dashboard.user);
    const onReloadMe = renderWorkspace({ reauthRequired: true, authMode: "own" });

    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));

    expect(companionApi.connectTwitch).toHaveBeenCalledTimes(1);
    expect(onReloadMe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Reconnect your Twitch account" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Predictions paused: reconnect Twitch" }),
    ).toBeVisible();
  });

  it("explains a failed last prediction", async () => {
    renderWorkspace(
      {},
      { ...dashboard, events: [event(2, "prediction_error", "Channel points are not enabled")] },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Channel points are not enabled");
  });

  it("updates from backend events without polling", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "Monitoring is paused" });

    await act(async () => {
      emitBackendEvent("status-changed", { ...idleStatus, monitoring: true, valorantRunning: true, localState: "menus" });
    });
    expect(screen.getByRole("heading", { name: "Watching for a match" })).toBeVisible();

    vi.mocked(companionApi.getDashboard).mockResolvedValue({ ...dashboard, activeSession: liveSession });
    await act(async () => {
      emitBackendEvent("dashboard-changed");
    });
    expect(await screen.findByRole("region", { name: "Live prediction" })).toBeVisible();
    expect(companionApi.getStatus).toHaveBeenCalledTimes(1);
  });

  it("has Diagnostics in dev builds only below the presets", async () => {
    renderWorkspace();
    const presets = await screen.findByText("Prediction presets");
    const diagnostics = screen.getByText("Diagnostics");
    expect(presets.compareDocumentPosition(diagnostics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
