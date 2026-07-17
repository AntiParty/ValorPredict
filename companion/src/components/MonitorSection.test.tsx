import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionApi } from "../api";
import type { DetectionStatus } from "../types";
import { MonitorSection } from "./MonitorSection";

vi.mock("../api", () => ({
  companionApi: {
    getStatus: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    resetCooldown: vi.fn(),
    clearLogs: vi.fn(),
    connectTwitch: vi.fn(),
  },
}));

vi.mock("../hooks/useWindowVisible", () => ({
  useWindowVisible: () => true,
}));

const status: DetectionStatus = {
  riotLockfileFound: false,
  riotClientRunning: false,
  valorantRunning: false,
  region: "unknown",
  shard: "unknown",
  localState: "unknown",
  gameMode: "unknown",
  confidence: 0,
  lastMatchIdHash: null,
  cooldownRemainingSeconds: 0,
  lastBackendResponse: "Waiting.",
  monitoring: true,
  logs: [],
};

describe("minimal monitor status", () => {
  beforeEach(() => {
    vi.mocked(companionApi.getStatus).mockResolvedValue(status);
  });

  it("shows essential facts and collapses development diagnostics", async () => {
    render(<MonitorSection user={null} onReconnect={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Waiting for Valorant" }),
    ).toBeVisible();
    const statusStrip = screen.getByText("State").closest("dl");
    expect(statusStrip).not.toBeNull();
    expect(within(statusStrip!).getByText("Valorant")).toBeVisible();
    expect(within(statusStrip!).getByText("State")).toBeVisible();
    expect(within(statusStrip!).getByText("Mode")).toBeVisible();
    expect(within(statusStrip!).queryByText("Cooldown")).not.toBeInTheDocument();

    const diagnostics = screen.getByText("Diagnostics");
    expect(screen.getByText(/Raw detection signals/i)).not.toBeVisible();
    fireEvent.click(diagnostics);
    expect(screen.getByText(/Raw detection signals/i)).toBeVisible();
  });
});
