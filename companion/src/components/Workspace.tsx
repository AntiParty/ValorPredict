import { companionApi } from "../api";
import type { useDashboard } from "../hooks/useDashboard";
import { useStatus } from "../hooks/useStatus";
import type { MeResponse } from "../types";
import { Diagnostics } from "./Diagnostics";
import { MonitorSection } from "./MonitorSection";
import { ActivePrediction } from "./predictions/ActivePrediction";
import { HealthBanners } from "./predictions/HealthBanners";
import { HostedConnectStep } from "./predictions/HostedConnectStep";
import { PredictionsDashboard } from "./predictions/PredictionsDashboard";

const developmentMode = import.meta.env.DEV;

interface Props {
  me: MeResponse;
  /** Owned by the connected shell so the header's account menu can see the open prediction. */
  dashboard: ReturnType<typeof useDashboard>;
  /** Reload `get_me` (after a reconnect). */
  onReloadMe: () => void;
}

// The connected screen, top to bottom: live prediction (only while one is open), status,
// problems that need action, presets with their test and activity, then dev diagnostics.
export function Workspace({ me, dashboard, onReloadMe }: Props) {
  const status = useStatus();

  const hosted = me.authMode === "hosted";
  const session = dashboard.data?.activeSession;
  const live = session?.status === "prediction_open" ? session : null;

  return (
    <>
      {live && <ActivePrediction session={live} onChanged={dashboard.refresh} />}

      <MonitorSection
        status={status.data}
        onStatus={status.apply}
        presets={dashboard.data?.presets}
        reauthRequired={me.reauthRequired}
      />

      {me.reauthRequired && hosted && <HostedConnectStep reconnect onConnected={onReloadMe} />}

      <HealthBanners
        reauthRequired={me.reauthRequired && !hosted}
        latestEvent={dashboard.data?.events[0] ?? null}
        onReconnect={async () => {
          await companionApi.connectTwitch();
          onReloadMe();
        }}
      />

      <PredictionsDashboard
        data={dashboard.data}
        error={dashboard.error}
        refresh={dashboard.refresh}
      />

      {developmentMode && <Diagnostics status={status.data} onStatus={status.apply} />}
    </>
  );
}
