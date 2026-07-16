import { useCallback, useEffect, useRef, useState } from "react";

import { companionApi } from "../../api";
import { useVisiblePolling } from "../../hooks/useVisiblePolling";
import { useWindowVisible } from "../../hooks/useWindowVisible";
import type {
  DashboardData,
  PresetGameMode,
  PresetInput,
  SettingsView,
} from "../../types";
import { ActivePrediction } from "./ActivePrediction";
import { EventsCard } from "./EventsCard";
import { PresetCard } from "./PresetCard";

type Notice = { kind: "success" | "error"; message: string } | null;
const DASHBOARD_POLL_MS = 8000;

export function PredictionsDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pollInterval, setPollInterval] = useState(15);
  const [persistedPollInterval, setPersistedPollInterval] = useState(15);
  const [settingsSaveFailed, setSettingsSaveFailed] = useState(false);
  const settingsSaving = useRef(false);
  const windowVisible = useWindowVisible();

  const refresh = useCallback(async () => {
    try {
      const next = await companionApi.getDashboard();
      setData((current) =>
        current && JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    } catch (error) {
      setNotice({ kind: "error", message: String(error) });
    }
  }, []);

  useEffect(() => {
    companionApi
      .loadSettings()
      .then((settings: SettingsView) => {
        setPollInterval(settings.pollIntervalSeconds);
        setPersistedPollInterval(settings.pollIntervalSeconds);
      })
      .catch(() => undefined);
  }, []);

  useVisiblePolling(refresh, DASHBOARD_POLL_MS, windowVisible);

  const run = useCallback(
    async (operation: () => Promise<{ message?: string }>, fallback: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await operation();
        setNotice({ kind: "success", message: result?.message ?? fallback });
        await refresh();
      } catch (error) {
        setNotice({ kind: "error", message: String(error) });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (!data) {
    return (
      <section className="predictions-panel">
        <div className="panel-heading">
          <div>
            <h2>Prediction presets</h2>
          </div>
        </div>
        <p className="muted-line">Loading your presets…</p>
      </section>
    );
  }

  const competitive = data.presets.find((preset) => preset.game_mode === "competitive");
  const custom = data.presets.find((preset) => preset.game_mode === "custom");
  const enabledCount = data.presets.filter((preset) => preset.enabled).length;
  const competitiveReady = Boolean(competitive?.enabled);

  const savePreset = (gameMode: PresetGameMode, input: PresetInput) =>
    run(async () => {
      await companionApi.savePreset(gameMode, input);
      return { message: `${gameMode === "competitive" ? "Competitive" : "Custom"} preset saved.` };
    }, "Preset saved.");

  const persistPollInterval = async () => {
    if (pollInterval === persistedPollInterval || settingsSaving.current) return;
    settingsSaving.current = true;
    setBusy(true);
    setSettingsSaveFailed(false);
    setNotice(null);
    try {
      await companionApi.saveSettings(pollInterval);
      setPersistedPollInterval(pollInterval);
      setNotice({ kind: "success", message: "Settings saved." });
    } catch (error) {
      setSettingsSaveFailed(true);
      setNotice({
        kind: "error",
        message: `${pollInterval}s not saved — ${String(error)}`,
      });
    } finally {
      settingsSaving.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="predictions-panel">
      <div className="panel-heading">
        <div>
          <h2>Prediction presets</h2>
        </div>
        <span className="quiet-pill">{enabledCount}/2 enabled</span>
      </div>

      {notice && <div className={`pred-notice ${notice.kind}`}>{notice.message}</div>}

      <div className="preset-list">
        {competitive && (
          <PresetCard
            preset={competitive}
            busy={busy}
            onSave={(input) => savePreset("competitive", input)}
          />
        )}
        {custom && (
          <PresetCard preset={custom} busy={busy} onSave={(input) => savePreset("custom", input)} />
        )}
      </div>

      <div className="test-row">
        <button
          className="button primary"
          type="button"
          disabled={busy || !competitiveReady}
          onClick={() =>
            run(() => companionApi.simulateMatchStart("competitive"), "Test prediction sent.")
          }
        >
          {competitiveReady ? "Send test prediction" : "Enable Competitive to test"}
        </button>
        <small>
          {competitiveReady
            ? "Opens a real prediction from your Competitive preset so you can confirm everything works — cancel it below anytime."
            : "Enable your Competitive preset before sending a real test prediction."}
        </small>
      </div>

      <ActivePrediction
        activeSession={data.activeSession}
        busy={busy}
        onResolve={(winner) => run(() => companionApi.resolvePrediction(winner), "Prediction resolved.")}
        onCancel={() => run(() => companionApi.cancelPrediction(), "Prediction cancelled.")}
      />

      <EventsCard events={data.events} />

      <details className="settings-disclosure">
        <summary>Settings</summary>
        <label className="poll-setting">
          <span>Detection polling — higher is lighter on your PC</span>
          <div className="range-row">
            <input
              type="range"
              min={10}
              max={60}
              step={5}
              value={pollInterval}
              disabled={busy}
              aria-label="Detection polling interval"
              aria-invalid={settingsSaveFailed}
              onChange={(event) => {
                setPollInterval(Number(event.target.value));
                setSettingsSaveFailed(false);
              }}
              onPointerUp={() => void persistPollInterval()}
              onKeyUp={() => void persistPollInterval()}
              onBlur={() => void persistPollInterval()}
            />
            <strong>{pollInterval}s</strong>
          </div>
        </label>
      </details>
    </section>
  );
}
