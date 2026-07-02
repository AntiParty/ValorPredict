import { formatDate } from "../../format";
import type { PredictionSession } from "../../types";

interface Props {
  activeSession: PredictionSession | null;
  busy: boolean;
  onResolve: (winner: "A" | "B") => void;
  onCancel: () => void;
}

export function ActivePrediction({ activeSession, busy, onResolve, onCancel }: Props) {
  const active = activeSession?.status === "prediction_open";

  return (
    <section className={`card active-card ${active ? "is-live" : ""}`}>
      <div className="preset-head">
        <div>
          <span className="card-kicker">Twitch channel</span>
          <h3>Current prediction</h3>
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
          <div className="resolution-row">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => onResolve("A")}
            >
              Resolve A
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => onResolve("B")}
            >
              Resolve B
            </button>
          </div>
          <button
            className="button danger wide"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel prediction
          </button>
        </>
      ) : (
        <div className="pred-empty">
          <strong>Waiting for a match</strong>
          <p>
            The companion opens your enabled preset automatically as soon as a
            supported match goes live.
          </p>
        </div>
      )}
    </section>
  );
}
