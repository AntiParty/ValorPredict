import { useDashboardMutation } from "../../hooks/useDashboardMutation";
import { api } from "../../lib/api";
import type { AutoPredictionPreset, PredictionSession, ValorantGameMode } from "../../types";

export function DeveloperTools({
  competitive,
  custom,
  activeSession,
}: {
  competitive: AutoPredictionPreset;
  custom: AutoPredictionPreset;
  activeSession?: PredictionSession | null;
}) {
  const active = activeSession?.status === "prediction_open";

  const simulate = useDashboardMutation(
    (gameMode: ValorantGameMode) => api.simulateMatchStart(gameMode),
    { successMessage: (data) => data.message },
  );

  return (
    <section className="card developer-card">
      <div className="card-heading">
        <div>
          <span className="card-kicker">Development mode</span>
          <h2>Trigger simulator</h2>
        </div>
        <span className="dev-badge">DEV</span>
      </div>
      <p>Exercise the backend without waiting for local game detection.</p>
      <div className="developer-actions">
        <button
          className="button button-primary wide"
          type="button"
          disabled={!competitive.enabled || active || simulate.isPending}
          onClick={() => simulate.mutate("competitive")}
        >
          Simulate Competitive Match
        </button>
        <button
          className="button button-secondary wide"
          type="button"
          disabled={!custom.enabled || active || simulate.isPending}
          onClick={() => simulate.mutate("custom")}
        >
          Simulate Custom Match
        </button>
      </div>
    </section>
  );
}
