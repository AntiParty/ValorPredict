import { useQuery } from "@tanstack/react-query";

import { Brand } from "../components/Brand";
import { ActivePrediction } from "../components/dashboard/ActivePrediction";
import { DeveloperTools } from "../components/dashboard/DeveloperTools";
import { Events } from "../components/dashboard/Events";
import { PresetCard } from "../components/dashboard/PresetCard";
import { api } from "../lib/api";

export function Dashboard() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
  });

  if (isPending) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        <span className="route-loading__spinner" aria-hidden="true" />
        <span>Loading your workspace…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="route-error" role="alert">
        <p>We couldn’t load your workspace. Please refresh to try again.</p>
      </div>
    );
  }

  const { user, presets, activeSession, events, developmentMode } = data;

  const competitive = presets.find((preset) => preset.game_mode === "competitive");
  const custom = presets.find((preset) => preset.game_mode === "custom");

  if (!competitive || !custom) {
    return (
      <div className="route-error" role="alert">
        <p>Your prediction presets are still being set up. Please refresh in a moment.</p>
      </div>
    );
  }

  const enabledCount = [competitive, custom].filter((preset) => preset.enabled).length;
  const state =
    activeSession?.status === "prediction_open"
      ? "Prediction live"
      : enabledCount
        ? "Ready"
        : "Setup needed";

  return (
    <>
      <header className="app-header">
        <div className="app-nav">
          <Brand />
          <div className="account">
            <span className="status-pill ready">
              <i />
              {state}
            </span>
            <span className="account-avatar">
              {user.twitch_profile_image_url ? (
                <img src={user.twitch_profile_image_url} alt="" />
              ) : (
                (user.twitch_display_name[0]?.toUpperCase() ?? "U")
              )}
            </span>
            <span className="account-name">{user.twitch_login}</span>
          </div>
        </div>
      </header>
      <main className="dashboard-shell">
        <section className="dashboard-intro">
          <div>
            <span className="eyebrow">Automation workspace</span>
            <h1>Prediction presets</h1>
            <p>Choose exactly what viewers see for each supported Valorant mode.</p>
          </div>
          <div className="summary">
            <span>{enabledCount}/2 presets enabled</span>
            <i style={{ "--progress": enabledCount / 2 } as React.CSSProperties} />
          </div>
        </section>
        <section className="workspace-grid">
          <div className="preset-stack">
            <PresetCard preset={competitive} />
            <PresetCard preset={custom} />
          </div>
          <aside className="sidebar-stack">
            <ActivePrediction activeSession={activeSession} />
            {developmentMode ? (
              <DeveloperTools
                competitive={competitive}
                custom={custom}
                activeSession={activeSession}
              />
            ) : null}
          </aside>
        </section>
        <Events events={events} developmentMode={developmentMode} />
      </main>
    </>
  );
}
