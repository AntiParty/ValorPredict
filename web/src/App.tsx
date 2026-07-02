import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { Connect } from "./pages/Connect";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";

// Single-window desktop app: which screen shows is a function of auth state, so
// there is no client-side router. First run -> Settings (enter Twitch creds);
// configured but signed out -> Connect; signed in -> Dashboard.
function AppShell() {
  const { status, configured, user } = useAuth();

  if (status === "loading") {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        <span className="route-loading__spinner" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    );
  }
  if (!configured) {
    return <Settings />;
  }
  if (!user) {
    return <Connect />;
  }
  return <Dashboard />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
