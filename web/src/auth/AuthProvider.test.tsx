import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { AuthProvider } from "./AuthProvider";

vi.mock("../lib/api", () => ({
  api: { me: vi.fn() },
}));

const meMock = vi.mocked(api.me);

function Consumer() {
  const { status, user, flash, clearFlash, refresh } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.twitch_login ?? "none"}</p>
      <p data-testid="flash">{flash ? `${flash.kind}:${flash.message}` : "none"}</p>
      <button type="button" onClick={() => clearFlash()}>
        clear flash
      </button>
      <button type="button" onClick={() => refresh()}>
        refresh
      </button>
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
    });

    renderProvider();

    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("ace");
  });

  it("resolves to unauthenticated when /api/me returns no user", async () => {
    meMock.mockResolvedValue({ user: null, flash: null });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("surfaces the one-shot flash and clears it on demand", async () => {
    meMock.mockResolvedValue({
      user: null,
      flash: { kind: "success", message: "Signed in." },
    });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("flash")).toHaveTextContent("success:Signed in.");
    });

    await userEvent.click(screen.getByRole("button", { name: "clear flash" }));

    expect(screen.getByTestId("flash")).toHaveTextContent("none");
  });
});
