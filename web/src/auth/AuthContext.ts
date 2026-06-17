import { createContext, useContext } from "react";

import type { FlashMessage, SafeUser } from "../types";

export interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: SafeUser | null;
  flash: FlashMessage | null;
  refresh: () => void;
  clearFlash: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return value;
}
