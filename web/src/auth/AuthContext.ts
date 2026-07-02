import { createContext, useContext } from "react";

import type { SafeUser } from "../types";

export interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: SafeUser | null;
  /** Whether Twitch credentials have been saved (first-run gate). */
  configured: boolean;
  refresh: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return value;
}
