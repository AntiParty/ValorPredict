import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../components/Toast";
import { api } from "../lib/api";
import type { DashboardData } from "../types";
import { Dashboard } from "./Dashboard";

vi.mock("../lib/api", () => ({
  api: {
    dashboard: vi.fn(),
    savePreset: vi.fn(),
    resolvePrediction: vi.fn(),
    cancelPrediction: vi.fn(),
    simulateMatchStart: vi.fn(),
  },
}));

const dashboardMock = vi.mocked(api.dashboard);

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    user: {
      id: 1,
      twitch_user_id: "u1",
      twitch_login: "ace",
      twitch_display_name: "Ace",
      twitch_profile_image_url: null,
      token_expires_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    presets: [
      {
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
      },
      {
        id: 2,
        twitch_user_id: "u1",
        game_mode: "custom",
        enabled: 0,
        title_template: "Custom?",
        outcome_a: "A",
        outcome_b: "B",
        prediction_window: 90,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    activeSession: null,
    events: [],
    developmentMode: false,
    ...overrides,
  };
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  dashboardMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Dashboard", () => {
  it("shows a loading state before the snapshot resolves", () => {
    dashboardMock.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders both preset cards once loaded", async () => {
    dashboardMock.mockResolvedValue(makeData());
    renderDashboard();

    expect(await screen.findByText("Competitive Preset")).toBeInTheDocument();
    expect(screen.getByText("Custom Preset")).toBeInTheDocument();
  });

  it("does not render the removed hosted-service cards", async () => {
    dashboardMock.mockResolvedValue(makeData());
    renderDashboard();

    await screen.findByText("Competitive Preset");
    expect(screen.queryByText("Local Companion App")).not.toBeInTheDocument();
    expect(screen.queryByText("Duo Command")).not.toBeInTheDocument();
    expect(screen.queryByText("Streamer showcase")).not.toBeInTheDocument();
  });

  it("hides developer tools outside development mode", async () => {
    dashboardMock.mockResolvedValue(makeData({ developmentMode: false }));
    renderDashboard();

    await screen.findByText("Competitive Preset");
    expect(screen.queryByText("Trigger simulator")).not.toBeInTheDocument();
  });

  it("shows developer tools in development mode", async () => {
    dashboardMock.mockResolvedValue(makeData({ developmentMode: true }));
    renderDashboard();

    expect(await screen.findByText("Trigger simulator")).toBeInTheDocument();
  });

  it("reflects the count of enabled presets in the summary", async () => {
    dashboardMock.mockResolvedValue(makeData());
    renderDashboard();

    expect(await screen.findByText("1/2 presets enabled")).toBeInTheDocument();
  });
});
