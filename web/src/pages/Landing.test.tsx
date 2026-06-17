import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { AuthContext, type AuthState } from "../auth/AuthContext";
import type { PublicResponse, SafeUser } from "../types";
import { Landing } from "./Landing";

vi.mock("../lib/api", () => ({
  api: { public: vi.fn() },
}));

const publicMock = vi.mocked(api.public);

const sampleData: PublicResponse = {
  stats: {
    connectedStreamers: 12,
    predictionsRun: 1240,
    channelPointsWagered: 88000,
  },
  streamers: [
    {
      twitch_login: "ace",
      twitch_display_name: "Ace",
      twitch_profile_image_url: null,
    },
  ],
};

function authValue(user: SafeUser | null): AuthState {
  return {
    status: user ? "authenticated" : "unauthenticated",
    user,
    flash: null,
    refresh: vi.fn(),
    clearFlash: vi.fn(),
  };
}

function renderLanding(user: SafeUser | null, data: PublicResponse = sampleData) {
  publicMock.mockResolvedValue(data);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(user)}>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  publicMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Landing", () => {
  it("shows platform metrics from /api/public", async () => {
    renderLanding(null);

    // 1,240 predictions render in compact notation once the query resolves.
    const figures = await screen.findAllByText("1.2K");
    expect(figures.length).toBeGreaterThan(0);
    const metrics = screen.getByLabelText("Platform activity");
    expect(within(metrics).getAllByText("1.2K").length).toBeGreaterThan(0);
  });

  it("lists connected streamers when present", async () => {
    renderLanding(null);

    expect(await screen.findAllByText("Ace")).not.toHaveLength(0);
  });

  it("shows an empty showcase state when no streamers are connected", async () => {
    renderLanding(null, { ...sampleData, streamers: [] });

    expect(
      await screen.findByText(/Early access channels are connecting now/i),
    ).toBeInTheDocument();
  });

  it("prompts logged-out visitors to start a free trial via Twitch OAuth", () => {
    renderLanding(null);

    const ctas = screen.getAllByRole("link", { name: /Start free trial/i });
    expect(ctas[0]).toHaveAttribute("href", "/auth/twitch");
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("sends authenticated visitors to their dashboard", () => {
    renderLanding({ twitch_login: "ace" } as SafeUser);

    const cta = screen.getAllByRole("link", { name: /Open Dashboard/i })[0];
    expect(cta).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("shows a restrained prediction preview without fabricated live metrics", () => {
    renderLanding(null);

    // Keeps an honest preview of what a prediction looks like.
    expect(
      screen.getByText("Will ace win this Valorant match?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();

    // Drops the made-up live data that read as "vibe coded".
    expect(screen.queryByText(/In the pool/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/viewers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/left to predict/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Predict$/i }),
    ).not.toBeInTheDocument();
  });
});
