import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../api";
import { idleStatus, preset } from "../test/fixtures";
import type { DetectionStatus } from "../types";
import { MonitorSection } from "./MonitorSection";

vi.mock("../api", () => ({
  companionApi: { startMonitoring: vi.fn(), stopMonitoring: vi.fn() },
}));

const presets = [preset("competitive", true), preset("custom", false)];
const watching = (overrides: Partial<DetectionStatus> = {}): DetectionStatus => ({
  ...idleStatus,
  monitoring: true,
  ...overrides,
});

function renderStatus(status: DetectionStatus, extra: { reauthRequired?: boolean } = {}) {
  const onStatus = vi.fn();
  render(<MonitorSection status={status} onStatus={onStatus} presets={presets} {...extra} />);
  return onStatus;
}

describe("status card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says paused once, with one Start button and no duplicate banner copy", () => {
    renderStatus(idleStatus);

    expect(screen.getByRole("heading", { name: "Monitoring is paused" })).toBeVisible();
    expect(screen.getAllByText(/paused/i)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /start monitoring/i })).toHaveLength(1);
    expect(screen.getByText(/Competitive is on, Custom is off/)).toBeVisible();
  });

  it("replaces the Valorant / State / Mode strip with a detail line", () => {
    renderStatus(watching({ valorantRunning: true, localState: "menus" }));

    expect(screen.getByRole("heading", { name: "Watching for a match" })).toBeVisible();
    expect(screen.getByText(/Valorant is in the menus\. Competitive is on/)).toBeVisible();
    expect(screen.queryByText("State")).toBeNull();
    expect(screen.queryByText("Mode")).toBeNull();
    expect(screen.queryByRole("term")).toBeNull();
  });

  it("names the game mode once a match is detected", () => {
    renderStatus(watching({ valorantRunning: true, localState: "current_game", gameMode: "competitive" }));

    expect(screen.getByRole("heading", { name: "Match detected" })).toBeVisible();
    expect(screen.getByText(/Competitive match in progress/)).toBeVisible();
  });

  it("waits for Valorant while monitoring", () => {
    renderStatus(watching());
    expect(screen.getByRole("heading", { name: "Waiting for Valorant" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop monitoring" })).toBeVisible();
  });

  it("reads 'Predictions paused: reconnect Twitch' while reauth is required", () => {
    renderStatus(watching({ valorantRunning: true, localState: "menus" }), { reauthRequired: true });

    expect(
      screen.getByRole("heading", { name: "Predictions paused: reconnect Twitch" }),
    ).toBeVisible();
    expect(screen.queryByText("Watching for a match")).toBeNull();
  });

  it("does not claim matches are detected when reauth is required and monitoring is off", () => {
    renderStatus(idleStatus, { reauthRequired: true });

    expect(screen.getByText("Reconnect Twitch, then start monitoring.")).toBeVisible();
    expect(screen.queryByText(/still detected/)).toBeNull();
  });

  it("says matches are still detected when reauth is required but monitoring is on", () => {
    renderStatus(watching(), { reauthRequired: true });

    expect(
      screen.getByText("Matches are still detected, but predictions won't open until you reconnect."),
    ).toBeVisible();
  });

  it("starts monitoring and hands the returned status to the parent", async () => {
    const next = watching();
    vi.mocked(companionApi.startMonitoring).mockResolvedValue(next);
    const onStatus = renderStatus(idleStatus);

    await userEvent.click(screen.getByRole("button", { name: "Start monitoring" }));

    expect(companionApi.startMonitoring).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(next);
  });

  it("stops monitoring when it is running", async () => {
    vi.mocked(companionApi.stopMonitoring).mockResolvedValue(idleStatus);
    const onStatus = renderStatus(watching());

    await userEvent.click(screen.getByRole("button", { name: "Stop monitoring" }));

    expect(companionApi.stopMonitoring).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(idleStatus);
  });

  it("shows a failure as an alert that stays", async () => {
    vi.mocked(companionApi.startMonitoring).mockRejectedValue("Riot Client not found");
    renderStatus(idleStatus);

    await userEvent.click(screen.getByRole("button", { name: "Start monitoring" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Riot Client not found");
  });

  it("shows a placeholder until the first status arrives", () => {
    render(<MonitorSection status={null} onStatus={vi.fn()} />);
    expect(screen.getByText("Checking monitoring")).toBeVisible();
  });
});
