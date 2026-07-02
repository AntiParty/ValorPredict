import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { AuthProvider } from "./AuthProvider";

vi.mock("../lib/api", () => ({
  api: { me: vi.fn() },
}));

const meMock = vi.mocked(api.me);

function Consumer() {
  const { status, user, configured } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.twitch_login ?? "none"}</p>
      <p data-testid="configured">{configured ? "yes" : "no"}</p>
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  meMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AuthProvider", () => {
  it("starts loading and resolves to authenticated when /api/me returns a user", async () => {
    meMock.mockResolvedValue({
      user: { twitch_login: "ace" } as never,
      flash: null,
      configured: true,
    });

    renderProvider();

    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("ace");
    expect(screen.getByTestId("configured")).toHaveTextContent("yes");
  });

  it("resolves to unauthenticated and unconfigured when /api/me is empty", async () => {
    meMock.mockResolvedValue({ user: null, flash: null, configured: false });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("configured")).toHaveTextContent("no");
  });

  it("reports configured even before the user signs in", async () => {
    meMock.mockResolvedValue({ user: null, flash: null, configured: true });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("configured")).toHaveTextContent("yes");
    });
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
  });
});
