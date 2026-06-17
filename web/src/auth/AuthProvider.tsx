import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "../lib/api";
import type { FlashMessage } from "../types";
import { AuthContext, type AuthState } from "./AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<FlashMessage | null>(null);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 30_000,
    retry: false,
  });

  // /api/me drains the one-shot OAuth flash server-side, so capture it into
  // local state the first time it arrives and let the UI clear it on demand.
  const incomingFlash = query.data?.flash ?? null;
  useEffect(() => {
    if (incomingFlash) {
      setFlash(incomingFlash);
    }
  }, [incomingFlash]);

  const clearFlash = useCallback(() => setFlash(null), []);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [queryClient]);

  const status: AuthState["status"] = query.isPending
    ? "loading"
    : query.data?.user
      ? "authenticated"
      : "unauthenticated";

  const value = useMemo<AuthState>(
    () => ({
      status,
      user: query.data?.user ?? null,
      flash,
      refresh,
      clearFlash,
    }),
    [status, query.data?.user, flash, refresh, clearFlash],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
