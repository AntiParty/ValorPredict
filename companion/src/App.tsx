import { useCallback, useEffect, useState } from "react";

import { companionApi } from "./api";
import { BootstrapError } from "./components/BootstrapError";
import { MonitorSection } from "./components/MonitorSection";
import { Brand } from "./components/predictions/Brand";
import { OnboardingWizard } from "./components/predictions/OnboardingWizard";
import { PredictionsDashboard } from "./components/predictions/PredictionsDashboard";
import { friendlyError, type UserFacingError } from "./errors";
import { initials } from "./format";
import type { MeResponse } from "./types";

const FALLBACK_REDIRECT = "http://localhost:3000/auth/twitch/callback";

type AuthState =
  | { status: "loading" }
  | { status: "ready"; me: MeResponse }
  | { status: "error"; error: UserFacingError };

const previewMode =
  import.meta.env.DEV && import.meta.env.VITE_COMPANION_PREVIEW === "true";

// Single-window desktop app: the visible screen is a function of auth state, so
// there's no router. Not connected -> setup; connected -> the local workspace.
export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [retrying, setRetrying] = useState(false);

  const loadMe = useCallback(async () => {
    setRetrying(true);
    try {
      const me = await companionApi.getMe();
      setAuth({ status: "ready", me });
    } catch (error) {
      if (previewMode) {
        setAuth({
          status: "ready",
          me: { user: null, configured: false, redirectUri: FALLBACK_REDIRECT },
        });
      } else {
        setAuth({
          status: "error",
          error: friendlyError(
            error,
            "The local companion service isn't responding. Make sure ValorPredict is running, then try again.",
          ),
        });
      }
    } finally {
      setRetrying(false);
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

  if (auth.status === "error") {
    return (
      <BootstrapError
        error={auth.error}
        onRetry={() => loadMe().catch(() => undefined)}
        retrying={retrying}
      />
    );
  }

  const { me } = auth;
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

      <MonitorSection user={me.user} onReconnect={loadMe} />
      <PredictionsDashboard />
    </main>
  );
}
