import { useState } from "react";

import { companionApi } from "../../api";
import { useNotice } from "../../hooks/useNotice";
import type { DashboardData, PresetGameMode, PresetInput } from "../../types";
import { Notice } from "../Notice";
import { EventsCard } from "./EventsCard";
import { PresetCard } from "./PresetCard";

interface Props {
  /** Dashboard data is owned by the workspace so the live prediction card can share it. */
  data: DashboardData | null;
  /** Last failed load, if any. */
  error: string | null;
  refresh: () => Promise<void>;
}

export function PredictionsDashboard({ data, error, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const { notice, showSuccess, showError, clear } = useNotice();

  if (!data) {
    return (
      <section className="predictions-panel">
        <h2>Prediction presets</h2>
        {error ? (
          <Notice notice={{ kind: "error", message: error }} />
        ) : (
          <p className="muted-line">Loading your presets…</p>
        )}
      </section>
    );
  }

  const competitive = data.presets.find((preset) => preset.game_mode === "competitive");
  const custom = data.presets.find((preset) => preset.game_mode === "custom");
  const competitiveReady = Boolean(competitive?.enabled);
  const login = data.user.twitch_login;

  const savePreset = async (gameMode: PresetGameMode, input: PresetInput) => {
    setBusy(true);
    try {
      await companionApi.savePreset(gameMode, input);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  async function sendTest() {
    setBusy(true);
    clear();
    try {
      const result = await companionApi.simulateMatchStart("competitive");
      showSuccess(result?.message ?? "Test prediction sent.");
      await refresh();
    } catch (caught) {
      showError(String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="predictions-panel">
      <h2>Prediction presets</h2>

      <div className="preset-list">
        {competitive && (
          <PresetCard
            preset={competitive}
            login={login}
            busy={busy}
            onSave={(input) => savePreset("competitive", input)}
          />
        )}
        {custom && (
          <PresetCard
            preset={custom}
            login={login}
            busy={busy}
            onSave={(input) => savePreset("custom", input)}
          />
        )}
      </div>

      <Notice notice={notice ?? (error ? { kind: "error", message: error } : null)} />

      <details className="more-disclosure">
        <summary>Test &amp; activity</summary>
        <div className="more-content">
          <div className="test-row">
            <button
              className="button secondary"
              type="button"
              disabled={busy || !competitiveReady}
              onClick={() => void sendTest()}
            >
              {competitiveReady ? "Send test prediction" : "Enable Competitive to test"}
            </button>
            <small>
              {competitiveReady
                ? "Opens a real prediction from your Competitive preset so you can confirm everything works. Cancel it from the live card anytime."
                : "Enable your Competitive preset before sending a real test prediction."}
            </small>
          </div>

          <EventsCard events={data.events} />
        </div>
      </details>
    </section>
  );
}
