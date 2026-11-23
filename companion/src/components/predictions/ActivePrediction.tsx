import { useState } from "react";

import { companionApi } from "../../api";
import { useNotice } from "../../hooks/useNotice";
import type { PredictionSession } from "../../types";
import { Notice } from "../Notice";
import { RelativeTime } from "../RelativeTime";

interface Props {
  session: PredictionSession;
  /** Re-read the dashboard after resolving or cancelling. */
  onChanged: () => Promise<void> | void;
}

// The live prediction. Rendered above the status card while one is open; the caller only
// mounts it for an open prediction, so there is no idle state here.
export function ActivePrediction({ session, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const { notice, showError, clear } = useNotice();

  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    clear();
    try {
      await operation();
      await onChanged();
    } catch (error) {
      showError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card live-card" aria-label="Live prediction">
      <div className="live-card__head">
        <span className="live-tag">
          <i aria-hidden="true" />
          Live
        </span>
        <strong className="live-card__title">{session.title}</strong>
        <span className="live-card__age">
          Started <RelativeTime value={session.started_at} />
        </span>
      </div>

      <div className="live-card__actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => void act(() => companionApi.resolvePrediction("A"))}
        >
          Resolve: {session.outcome_a_label || "Outcome A"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => void act(() => companionApi.resolvePrediction("B"))}
        >
          Resolve: {session.outcome_b_label || "Outcome B"}
        </button>
        <button
          className="button danger"
          type="button"
          disabled={busy}
          onClick={() => void act(() => companionApi.cancelPrediction())}
        >
          Cancel prediction
        </button>
      </div>
      <Notice notice={notice} />
    </section>
  );
}
