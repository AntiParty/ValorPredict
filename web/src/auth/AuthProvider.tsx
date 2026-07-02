import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";

import { api } from "../lib/api";
import { AuthContext, type AuthState } from "./AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 30_000,
    retry: false,
  });

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
      configured: query.data?.configured ?? false,
      refresh,
    }),
    [status, query.data?.user, query.data?.configured, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
