import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRoutes } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { ToastProvider } from "./components/Toast";
import { api } from "./lib/api";
import type { DashboardData, MeResponse, PublicResponse } from "./types";

vi.mock("./lib/api", () => ({
  api: {
    me: vi.fn(),
    public: vi.fn(),
    dashboard: vi.fn(),
  },
}));

const meMock = vi.mocked(api.me);
const publicMock = vi.mocked(api.public);
const dashboardMock = vi.mocked(api.dashboard);

const loggedOut: MeResponse = { user: null, flash: null };
const loggedIn: MeResponse = {
  user: { twitch_login: "ace", twitch_display_name: "Ace" } as never,
  flash: null,
};

const publicData: PublicResponse = {
  stats: { connectedStreamers: 0, predictionsRun: 0, channelPointsWagered: 0 },
  streamers: [],
};

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  meMock.mockReset();
  publicMock.mockReset().mockResolvedValue(publicData);
  dashboardMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppRoutes", () => {
  it("renders the public landing at the root", async () => {
    meMock.mockResolvedValue(loggedOut);

    renderAt("/");

    expect(
      await screen.findByText(/Automatic predictions\. Zero interruptions\./i),
    ).toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor away from the dashboard", async () => {
    meMock.mockResolvedValue(loggedOut);

    renderAt("/dashboard");

    // Lands back on the public site, never shows the workspace heading.
    expect(
      await screen.findByText(/Automatic predictions\. Zero interruptions\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Prediction presets")).not.toBeInTheDocument();
  });

  it("lets an authenticated visitor reach the dashboard", async () => {
    meMock.mockResolvedValue(loggedIn);
    dashboardMock.mockResolvedValue({
      user: {
        twitch_login: "ace",
        twitch_display_name: "Ace",
        twitch_profile_image_url: null,
        has_local_api_key: false,
        local_api_key_created_at: null,
        public_showcase_enabled: false,
      },
      presets: [
        {
          game_mode: "competitive",
          enabled: 1,
          title_template: "t",
          outcome_a: "a",
          outcome_b: "b",
          prediction_window: 120,
        },
        {
          game_mode: "custom",
          enabled: 0,
          title_template: "t",
          outcome_a: "a",
          outcome_b: "b",
          prediction_window: 120,
        },
      ],
      activeSession: null,
      events: [],
      localApiKeyReveal: null,
      duo: {
        config: {
          enabled: 0,
          public_token: "tok",
          template: "{names}",
          fallback_text: "solo",
        },
        shoutouts: [],
        url: "https://vap.example/duo/tok",
      },
      developmentMode: false,
    } as unknown as DashboardData);

    renderAt("/dashboard");

    expect(await screen.findByText("Prediction presets")).toBeInTheDocument();
  });
});
