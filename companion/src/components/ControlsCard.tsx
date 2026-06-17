import type { DetectionStatus } from "../types";

interface Props {
  status: DetectionStatus;
  busy: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPing: () => Promise<void>;
  onPregame: () => Promise<void>;
  onCompetitive: () => Promise<void>;
  onCustom: () => Promise<void>;
  onResetCooldown: () => Promise<void>;
}

export function ControlsCard({
  status,
  busy,
  onStart,
  onStop,
  onPing,
  onPregame,
  onCompetitive,
  onCustom,
  onResetCooldown,
}: Props) {
  return (
    <section className="panel controls-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Event console</span>
          <h2>Controls</h2>
        </div>
        <span className={`pill ${status.monitoring ? "good" : "neutral"}`}>
          {status.monitoring ? "Monitoring" : "Manual mode"}
        </span>
      </div>

      <button
        className="button current-game-button"
        disabled={busy}
        onClick={onCompetitive}
      >
        <span>
          <small>Works without Valorant</small>
          Simulate Competitive
        </span>
        <b>GO</b>
      </button>

      <div className="control-grid">
        <button className="button secondary" disabled={busy} onClick={onCustom}>
          Simulate Custom
        </button>
        <button className="button secondary" disabled={busy} onClick={onPregame}>
          Simulate Pre-Game
        </button>
        <button className="button secondary" disabled={busy} onClick={onPing}>
          Send Test Ping
        </button>
        <button
          className="button secondary"
          disabled={busy || status.monitoring}
          onClick={onStart}
        >
          Start Monitoring
        </button>
        <button
          className="button secondary"
          disabled={busy || !status.monitoring}
          onClick={onStop}
        >
          Stop Monitoring
        </button>
      </div>
      <button className="text-button" disabled={busy} onClick={onResetCooldown}>
        Reset cooldown
      </button>
    </section>
  );
}
