import { useCallback, useEffect, useState } from "react";

import { companionApi } from "./api";
import { AccountMenu } from "./components/AccountMenu";
import { BootstrapError } from "./components/BootstrapError";
import { AppFrame } from "./components/Titlebar";
import { OnboardingWizard } from "./components/predictions/OnboardingWizard";
import { Workspace } from "./components/Workspace";
import { friendlyError, type UserFacingError } from "./errors";
import { useDashboard } from "./hooks/useDashboard";
import { useBackendEvent } from "./hooks/useBackendEvent";
import { WindowVisibleProvider } from "./hooks/useWindowVisible";
import type { MeResponse, SafeUser } from "./types";

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
          me: {
            user: null,
            configured: false,
            redirectUri: FALLBACK_REDIRECT,
            authMode: "hosted",
            hostedAvailable: true,
            reauthRequired: false,
          },
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

  // The reauth flag and the signed-in account change in the backend (`dashboard-changed`
  // fires for both). Re-read `get_me` quietly and only re-render if something we show differs.
  useBackendEvent<null>("dashboard-changed", () => {
    companionApi
      .getMe()
      .then((me) =>
        setAuth((current) => {
          if (current.status !== "ready") return current;
          const before = current.me;
          const same =
            before.reauthRequired === me.reauthRequired &&
            before.authMode === me.authMode &&
            before.configured === me.configured &&
            before.user?.id === me.user?.id;
          return same ? current : { status: "ready", me };
        }),
      )
      .catch(() => undefined);
  });

  if (auth.status === "loading") {
    return (
      <AppFrame center>
        <div className="route-loading" role="status" aria-live="polite">
          <span className="route-loading__spinner" aria-hidden="true" />
          <span>Loading</span>
        </div>
      </AppFrame>
    );
  }

  if (auth.status === "error") {
    return (
      <AppFrame center>
        <BootstrapError
          error={auth.error}
          onRetry={() => loadMe().catch(() => undefined)}
          retrying={retrying}
        />
      </AppFrame>
    );
  }

  const { me } = auth;
  if (!me.user) {
    return (
      <AppFrame center>
        <OnboardingWizard me={me} onAdvance={loadMe} />
      </AppFrame>
    );
  }

  return (
    <WindowVisibleProvider>
      <ConnectedShell
        me={me}
        user={me.user}
        onReloadMe={() => loadMe().catch(() => undefined)}
      />
    </WindowVisibleProvider>
  );
}

// Header and workspace share one dashboard fetch, so the account menu knows whether a
// prediction is open (disconnecting would strand it).
function ConnectedShell({
  me,
  user,
  onReloadMe,
}: {
  me: MeResponse;
  user: SafeUser;
  onReloadMe: () => void;
}) {
  const dashboard = useDashboard();
  const predictionOpen = dashboard.data?.activeSession?.status === "prediction_open";

  return (
    <AppFrame
      titlebar={
        <AccountMenu user={user} predictionOpen={predictionOpen} onDisconnected={onReloadMe} />
      }
    >
      <Workspace me={me} dashboard={dashboard} onReloadMe={onReloadMe} />
    </AppFrame>
  );
}
