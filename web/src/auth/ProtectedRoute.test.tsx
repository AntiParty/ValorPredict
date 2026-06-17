import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthState } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

function renderWithAuth(status: AuthState["status"]) {
  const value: AuthState = {
    status,
    user: status === "authenticated" ? ({ twitch_login: "ace" } as never) : null,
    flash: null,
    refresh: vi.fn(),
    clearFlash: vi.fn(),
  };

  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/" element={<div>Public landing</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Secret workspace</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("ProtectedRoute", () => {
  it("renders the protected content when authenticated", () => {
    renderWithAuth("authenticated");
    expect(screen.getByText("Secret workspace")).toBeInTheDocument();
  });

  it("redirects to the public landing when unauthenticated", () => {
    renderWithAuth("unauthenticated");
    expect(screen.queryByText("Secret workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Public landing")).toBeInTheDocument();
  });

  it("shows a loading state while auth is resolving", () => {
    renderWithAuth("loading");
    expect(screen.queryByText("Secret workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
