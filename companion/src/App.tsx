import { useCallback, useEffect, useState } from "react";

import { companionApi } from "./api";
import { MonitorSection } from "./components/MonitorSection";
import { Brand } from "./components/predictions/Brand";
import { OnboardingWizard } from "./components/predictions/OnboardingWizard";
import { PredictionsDashboard } from "./components/predictions/PredictionsDashboard";
import { initials } from "./format";
import type { MeResponse } from "./types";

const FALLBACK_REDIRECT = "http://localhost:3000/auth/twitch/callback";

type AuthState = { status: "loading" } | { status: "ready"; me: MeResponse };

// Single-window desktop app: the visible screen is a function of auth state, so
// there's no router. Not connected -> the setup wizard (create app -> add keys
// -> connect); connected -> the predictions + monitoring workspace.
export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  const loadMe = useCallback(async () => {
    try {
      const me = await companionApi.getMe();
      setAuth({ status: "ready", me });
    } catch {
      // A plain Vite preview has no Tauri bridge — fall back to the setup screen
      // so the UI still renders during design work.
      setAuth({
        status: "ready",
        me: { user: null, configured: false, redirectUri: FALLBACK_REDIRECT },
      });
    }
  }, []);

  useEffect(() => {
    loadMe().catch(() => undefined);
  }, [loadMe]);

  if (auth.status === "loading") {
    return (
      <main className="companion-shell">
        <div className="route-loading" role="status" aria-live="polite">
          <span className="route-loading__spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      </main>
    );
  }

  const { me } = auth;
  // First run through registering credentials and connecting is one continuous
  // wizard; the workspace only renders once an account is connected.
  if (!me.user) {
    return <OnboardingWizard me={me} onAdvance={loadMe} />;
  }

  return (
    <main className="companion-shell">
      <header className="companion-header">
        <Brand />
        <div className="account">
          <span className="account-avatar">{initials(me.user.twitch_display_name)}</span>
          <span className="account-name">{me.user.twitch_login}</span>
        </div>
      </header>

      <PredictionsDashboard />
      <MonitorSection user={me.user} onReconnect={loadMe} />
    </main>
  );
}
