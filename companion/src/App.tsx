import { useCallback, useEffect, useState } from "react";

import { companionApi } from "./api";
import { ControlsCard } from "./components/ControlsCard";
import { LogPanel } from "./components/LogPanel";
import { SetupCard } from "./components/SetupCard";
import { StatusGrid } from "./components/StatusGrid";
import type { DetectionStatus, SettingsView } from "./types";

const developmentMode = import.meta.env.DEV;

const emptySettings: SettingsView = {
  backendUrl: "http://localhost:3000",
  localApiKeyMasked: "",
  hasLocalApiKey: false,
  pollIntervalSeconds: 4,
  monitoringEnabled: false,
};

const emptyStatus: DetectionStatus = {
  backendConnected: false,
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
  lastBackendResponse: "No backend request yet.",
  monitoring: false,
  duoEnabled: false,
  duoStatus: "Duo command inactive.",
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

export function App() {
  const [settings, setSettings] = useState(emptySettings);
  const [status, setStatus] = useState(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loadedSettings, loadedStatus] = await Promise.all([
        companionApi.loadSettings(),
        companionApi.getStatus(),
      ]);
      setSettings(loadedSettings);
      setStatus(loadedStatus);
    } catch {
      // Static Vite previews do not have the Tauri command bridge.
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await operation();
      if (result && typeof result === "object" && "message" in result) {
        setNotice(String(result.message));
      }
      await refresh();
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };

  const recentHistory = [...status.logs].reverse().slice(0, 5);
  const modeLabel =
    status.gameMode === "unknown" ? "No supported mode yet" : formatLabel(status.gameMode);

  return (
    <main className={`companion-shell ${developmentMode ? "is-development" : ""}`}>
      <header className="companion-header">
        <div className="brand-lockup">
          <span className="brand-symbol" aria-hidden="true"><i /></span>
          <div>
            <strong>Valorant Auto Predictions</strong>
            <span>Local companion</span>
          </div>
        </div>
        {developmentMode && <span className="dev-chip">Development</span>}
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="overview">
        <div className="overview-copy">
          <span className="section-label">Companion status</span>
          <h1>{friendlyState(status)}</h1>
          <p>
            {status.monitoring
              ? "You can close this window. Detection will keep running from the system tray."
              : "Start monitoring when you want the companion to detect supported Valorant matches."}
          </p>
          <button
            className={`primary-action ${status.monitoring ? "pause" : ""}`}
            disabled={busy || !settings.hasLocalApiKey}
            onClick={() =>
              run(status.monitoring ? companionApi.stopMonitoring : companionApi.startMonitoring)
            }
          >
            <span className="action-dot" />
            {status.monitoring ? "Stop monitoring" : "Start monitoring"}
          </button>
          {!settings.hasLocalApiKey && (
            <small className="action-help">Add the local API key below before monitoring.</small>
          )}
        </div>

        <div className={`monitor-visual ${status.monitoring ? "active" : ""}`}>
          <div className="monitor-orbit"><span><i /></span></div>
          <div className="monitor-readout">
            <span>{status.monitoring ? "Listening locally" : "Paused"}</span>
            <strong>{modeLabel}</strong>
            <small>
              {status.valorantRunning ? "Valorant is running" : "Valorant is not running"}
            </small>
          </div>
        </div>
      </section>

      <section className="quick-grid">
        <article className="info-card">
          <div className="card-top">
            <span className="section-label">Backend</span>
            <i className={status.backendConnected ? "good" : ""} />
          </div>
          <strong>{status.backendConnected ? "Connected" : "Not connected"}</strong>
          <p>{settings.hasLocalApiKey ? settings.backendUrl : "Local API key required"}</p>
        </article>
        <article className="info-card">
          <div className="card-top">
            <span className="section-label">Detected mode</span>
            <i className={status.gameMode !== "unknown" ? "good" : ""} />
          </div>
          <strong>{modeLabel}</strong>
          <p>Only Competitive and Custom trigger presets.</p>
        </article>
        <article className="info-card">
          <div className="card-top">
            <span className="section-label">Latest status</span>
            <i className={status.localState === "current_game" ? "live" : ""} />
          </div>
          <strong>{formatLabel(status.localState)}</strong>
          <p>{status.lastBackendResponse}</p>
        </article>
        <article className="info-card">
          <div className="card-top">
            <span className="section-label">Duo command <em className="beta-tag">Beta</em></span>
            <i className={status.duoEnabled ? "good" : ""} />
          </div>
          <strong>{status.duoEnabled ? "On" : "Off"}</strong>
          <p>{status.duoEnabled ? status.duoStatus : "Enable it from your dashboard."}</p>
        </article>
      </section>

      <section className="content-grid">
        <SetupCard
          settings={settings}
          busy={busy}
          onSave={async (backendUrl, localApiKey, pollInterval) =>
            run(async () => {
              const saved = await companionApi.saveSettings(
                backendUrl,
                localApiKey,
                pollInterval,
              );
              setSettings(saved);
              return { message: "Settings saved." };
            })
          }
          onTest={() => run(companionApi.testConnection)}
        />

        <section className="panel history-panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">Recent activity</span>
              <h2>Status history</h2>
            </div>
            <span className="quiet-pill">{recentHistory.length} events</span>
          </div>
          <div className="friendly-history">
            {recentHistory.length === 0 ? (
              <div className="history-empty">
                <span className="empty-icon"><i /></span>
                <strong>No activity yet</strong>
                <p>Connection and detection updates will appear here.</p>
              </div>
            ) : (
              recentHistory.map((entry, index) => (
                <div className="history-row" key={`${entry.timestamp}-${index}`}>
                  <i className={entry.level} />
                  <div>
                    <strong>{entry.message}</strong>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </section>

      <footer className="tray-note">
        <span className="tray-icon"><i /></span>
        <div>
          <strong>Runs quietly in the system tray</strong>
          <p>Closing this window hides it. Use the tray menu to reopen it or fully quit.</p>
        </div>
      </footer>

      {developmentMode && (
        <section className="developer-zone">
          <div className="developer-heading">
            <span>Development tools</span>
            <p>Simulation, detector telemetry, and sanitized runtime logs.</p>
          </div>
          <StatusGrid status={status} />
          <ControlsCard
            status={status}
            busy={busy}
            onStart={() => run(companionApi.startMonitoring)}
            onStop={() => run(companionApi.stopMonitoring)}
            onPing={() => run(companionApi.testConnection)}
            onPregame={() => run(companionApi.simulatePregame)}
            onCompetitive={() => run(companionApi.simulateCompetitiveCurrentGame)}
            onCustom={() => run(companionApi.simulateCustomCurrentGame)}
            onResetCooldown={() => run(companionApi.resetCooldown)}
          />
          <section className="telemetry-strip">
            <div>
              <span>Last MatchID hash</span>
              <strong>
                {status.lastMatchIdHash ? `${status.lastMatchIdHash.slice(0, 12)}...` : "None"}
              </strong>
            </div>
            <div>
              <span>Cooldown</span>
              <strong>{status.cooldownRemainingSeconds}s</strong>
            </div>
            <div>
              <span>Last backend response</span>
              <strong>{status.lastBackendResponse}</strong>
            </div>
          </section>
          <LogPanel logs={status.logs} onClear={() => run(companionApi.clearLogs)} />
        </section>
      )}
    </main>
  );
}
