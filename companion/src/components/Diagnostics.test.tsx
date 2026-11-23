import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../api";
import { idleStatus } from "../test/fixtures";
import { emitBackendEvent, resetBackendEvents } from "../test/tauriEvents";
import { Diagnostics, METRICS_REFRESH_MS } from "./Diagnostics";

vi.mock("@tauri-apps/api/event", () => import("../test/tauriEvents").then((m) => m.eventModule));
vi.mock("../api", () => ({
  companionApi: {
    getLogs: vi.fn(),
    getDetectionMetrics: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    resetCooldown: vi.fn(),
    clearLogs: vi.fn(),
  },
}));

const metrics = {
  lastPollMs: 12,
  loopbackCallsLastMinute: 0,
  riotServerCallsLastMinute: 3,
  logReadsLastMinute: 0,
  processScansLastMinute: 3,
};
const log = { timestamp: "2026-10-02T12:00:00Z", level: "info", message: "Polled Riot" };

async function open() {
  const details = screen.getByText("Diagnostics").closest("details")!;
  details.open = true;
  await act(async () => {
    fireEvent(details, new Event("toggle"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(companionApi.getLogs).mockResolvedValue([log]);
  vi.mocked(companionApi.getDetectionMetrics).mockResolvedValue(metrics);
});
afterEach(() => {
  vi.useRealTimers();
  resetBackendEvents();
});

describe("Diagnostics", () => {
  it("fetches nothing until it is opened", async () => {
    render(<Diagnostics status={idleStatus} onStatus={vi.fn()} />);
    await act(async () => undefined);

    expect(companionApi.getLogs).not.toHaveBeenCalled();
    expect(companionApi.getDetectionMetrics).not.toHaveBeenCalled();
    expect(screen.queryByText("Debug log")).toBeNull();
  });

  it("loads logs and metrics when opened and shows the counters", async () => {
    render(<Diagnostics status={idleStatus} onStatus={vi.fn()} />);
    await open();

    expect(companionApi.getLogs).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Polled Riot")).toBeVisible();
    expect(screen.getByText("Riot server calls / min")).toBeVisible();
    expect(screen.getByText("12 ms")).toBeVisible();
  });

  it("re-reads logs on logs-changed only while open", async () => {
    render(<Diagnostics status={idleStatus} onStatus={vi.fn()} />);
    act(() => emitBackendEvent("logs-changed"));
    expect(companionApi.getLogs).not.toHaveBeenCalled();

    await open();
    vi.mocked(companionApi.getLogs).mockResolvedValue([log, { ...log, message: "Second line" }]);
    await act(async () => emitBackendEvent("logs-changed"));

    expect(companionApi.getLogs).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Second line")).toBeVisible();
  });

  it("refreshes metrics every 5 s while open and stops once closed", async () => {
    vi.useFakeTimers();
    render(<Diagnostics status={idleStatus} onStatus={vi.fn()} />);
    await open();
    expect(companionApi.getDetectionMetrics).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(METRICS_REFRESH_MS));
    expect(companionApi.getDetectionMetrics).toHaveBeenCalledTimes(2);

    const details = screen.getByText("Diagnostics").closest("details")!;
    details.open = false;
    await act(async () => {
      fireEvent(details, new Event("toggle"));
    });
    await act(() => vi.advanceTimersByTimeAsync(METRICS_REFRESH_MS * 3));
    expect(companionApi.getDetectionMetrics).toHaveBeenCalledTimes(2);
  });

  it("has a single Start/Stop button and Clear logs only in the log panel", async () => {
    render(<Diagnostics status={{ ...idleStatus, monitoring: true }} onStatus={vi.fn()} />);
    await open();

    expect(screen.getAllByRole("button", { name: /start monitoring|stop monitoring/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Stop monitoring" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /clear logs/i })).toHaveLength(1);
  });

  it("clears logs through the log panel", async () => {
    vi.mocked(companionApi.clearLogs).mockResolvedValue(idleStatus);
    const onStatus = vi.fn();
    render(<Diagnostics status={idleStatus} onStatus={onStatus} />);
    await open();

    await act(async () => {
      screen.getByRole("button", { name: "Clear logs" }).click();
    });

    expect(companionApi.clearLogs).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(idleStatus);
  });

  it("renders the tiles as .diag-tile", async () => {
    const { container } = render(<Diagnostics status={idleStatus} onStatus={vi.fn()} />);
    await open();
    expect(container.querySelectorAll(".diag-tile").length).toBeGreaterThanOrEqual(6);
    expect(container.querySelector(".status-card")).toBeNull();
  });
});
