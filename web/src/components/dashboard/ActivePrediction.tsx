import { useDashboardMutation } from "../../hooks/useDashboardMutation";
import { formatDate } from "../../lib/format";
import { api } from "../../lib/api";
import type { PredictionSession } from "../../types";

export function ActivePrediction({
  activeSession,
}: {
  activeSession?: PredictionSession | null;
}) {
  const active = activeSession?.status === "prediction_open";

  const resolve = useDashboardMutation((winner: "A" | "B") => api.resolvePrediction(winner), {
    successMessage: (data) => data.message,
  });
  const cancel = useDashboardMutation(() => api.cancelPrediction(), {
    successMessage: (data) => data.message,
  });

  const busy = resolve.isPending || cancel.isPending;

  return (
    <section className={`card active-card ${active ? "is-live" : ""}`}>
      <div className="card-heading">
        <div>
          <span className="card-kicker">Twitch channel</span>
          <h2>Current prediction</h2>
        </div>
        <span className={`status-pill ${active ? "live" : ""}`}>
          <i />
          {active ? "Live" : "Idle"}
        </span>
      </div>
      {active && activeSession ? (
        <>
          <div className="active-copy">
            <strong>{activeSession.title}</strong>
            <span>Started {formatDate(activeSession.started_at)}</span>
          </div>
          <div className="resolution-grid">
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => resolve.mutate("A")}
            >
              Resolve A
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => resolve.mutate("B")}
            >
              Resolve B
            </button>
          </div>
          <button
            className="button button-danger wide"
            type="button"
            disabled={busy}
            onClick={() => cancel.mutate()}
          >
            Cancel prediction
          </button>
        </>
      ) : (
        <div className="empty-state">
          <strong>Waiting for a match</strong>
          <p>
            The companion can trigger your enabled preset as soon as a supported game
            starts.
          </p>
        </div>
      )}
    </section>
  );
}
