import { useCallback, useEffect, useState } from "react";

import { companionApi } from "../api";
import { useWindowVisible } from "../hooks/useWindowVisible";
import { HealthBanners } from "./predictions/HealthBanners";
import type { DetectionStatus, SafeUser } from "../types";
import { LogPanel } from "./LogPanel";
import { StatusGrid } from "./StatusGrid";

const developmentMode = import.meta.env.DEV;

// How often the UI re-reads detector status. Detection itself runs in the Rust
// backend on its own cadence; this is only the on-screen refresh, so a gentle
// interval keeps the window light without affecting detection.
const STATUS_POLL_MS = 3000;

const emptyStatus: DetectionStatus = {
  riotLockfileFound: false,
  riotClientRunning: false,
  valorantRunning: false,
  region: "unknown",
  shard: "unknown",
  localState: "unknown",
  gameMode: "unknown",
  confidence: 0,
  lastMatchIdHash: null,
  cooldownRemainingSeconds: 0,
  lastBackendResponse: "No detection yet.",
  monitoring: false,
  logs: [],
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyState(status: DetectionStatus) {
  if (!status.monitoring) return "Monitoring is paused";
  if (!status.valorantRunning) return "Waiting for Valorant";
  if (status.localState === "current_game") return "Match detected";
  if (status.localState === "pre_game") return "Preparing for match";
  if (status.localState === "menus") return "Valorant menus detected";
  return "Watching Valorant";
}

interface Props {
  user: SafeUser | null;
  onReconnect: () => void;
}

export function MonitorSection({ user, onReconnect }: Props) {
  const [status, setStatus] = useState(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const windowVisible = useWindowVisible();

  const refresh = useCallback(async () => {
    try {
      setStatus(await companionApi.getStatus());
    } catch {
      // The Tauri command bridge is absent in a plain Vite preview.
    }
  }, []);

  useEffect(() => {
    // Don't poll an invisible window — resume on show.
    if (!windowVisible) return;
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => refresh().catch(() => undefined), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, windowVisible]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await operation();
      if (result && typeof result === "object" && "message" in result) {
        setNotice(String((result as { message: unknown }).message));
      }
      await refresh();
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };

  const modeLabel =
    status.gameMode === "unknown" ? "No supported mode yet" : formatLabel(status.gameMode);

  return (
    <section className="monitor-section">
      {notice && <div className="notice">{notice}</div>}

      <section className="status-card">
        <div className="status-card__main">
          <span className="section-label">Companion status</span>
          <h1>{friendlyState(status)}</h1>
          <p>
            {status.monitoring
              ? "You can close this window — detection keeps running from the system tray. Reopen it any time from the tray icon."
              : "Start monitoring to detect supported Valorant matches and open predictions automatically."}
          </p>
          <button
            className={`primary-action ${status.monitoring ? "pause" : ""}`}
            disabled={busy}
            onClick={() =>
              run(status.monitoring ? companionApi.stopMonitoring : companionApi.startMonitoring)
            }
          >
            <span className={`action-dot ${status.monitoring ? "on" : ""}`} />
            {status.monitoring ? "Stop monitoring" : "Start monitoring"}
          </button>
        </div>

        <dl className="status-strip">
          <div>
            <dt>Mode</dt>
            <dd className={status.gameMode !== "unknown" ? "good" : ""}>{modeLabel}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd className={status.localState === "current_game" ? "live" : ""}>
              {formatLabel(status.localState)}
            </dd>
          </div>
          <div>
            <dt>Cooldown</dt>
            <dd className={status.cooldownRemainingSeconds > 0 ? "live" : ""}>
              {status.cooldownRemainingSeconds}s
            </dd>
          </div>
        </dl>
      </section>

      <HealthBanners
        status={status}
        user={user}
        onStartMonitoring={() => run(companionApi.startMonitoring)}
        onReconnect={() =>
          run(async () => {
            await companionApi.connectTwitch();
            onReconnect();
          })
        }
      />

      {developmentMode && (
        <section className="developer-zone">
          <div className="developer-heading">
            <span>Detector telemetry</span>
            <p>Raw detection signals and sanitized runtime logs.</p>
          </div>
          <StatusGrid status={status} />
          <div className="control-grid">
            <button
              className="button secondary"
              disabled={busy || status.monitoring}
              onClick={() => run(companionApi.startMonitoring)}
            >
              Start Monitoring
            </button>
            <button
              className="button secondary"
              disabled={busy || !status.monitoring}
              onClick={() => run(companionApi.stopMonitoring)}
            >
              Stop Monitoring
            </button>
            <button className="button secondary" disabled={busy} onClick={() => run(companionApi.resetCooldown)}>
              Reset Cooldown
            </button>
            <button className="button secondary" disabled={busy} onClick={() => run(companionApi.clearLogs)}>
              Clear Logs
            </button>
          </div>
          <LogPanel logs={status.logs} onClear={() => run(companionApi.clearLogs)} />
        </section>
      )}
    </section>
  );
}
