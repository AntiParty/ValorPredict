import { useState } from "react";

import { companionApi } from "../api";
import { titleCase } from "../format";
import { useNotice } from "../hooks/useNotice";
import type { AutoPredictionPreset, DetectionStatus } from "../types";
import { Notice } from "./Notice";

type Tone = "off" | "watching" | "live" | "warn";

interface Summary {
  tone: Tone;
  headline: string;
  detail: string;
}

function presetSummary(presets: AutoPredictionPreset[] | undefined): string {
  if (!presets?.length) return "";
  const word = (mode: string) => (mode === "competitive" ? "Competitive" : "Custom");
  return presets
    .map((preset) => `${word(preset.game_mode)} is ${preset.enabled ? "on" : "off"}`)
    .join(", ");
}

// One headline and one detail line say everything the old headline, paragraph, banners
// and Valorant / State / Mode strip said between them.
export function summarize(
  status: DetectionStatus,
  presets: AutoPredictionPreset[] | undefined,
  reauthRequired: boolean,
): Summary {
  const presetsLine = presetSummary(presets);
  const withPresets = (text: string) => (presetsLine ? `${text} ${presetsLine}.` : text);
  const mode = status.gameMode === "unknown" ? "" : `${titleCase(status.gameMode)} `;

  if (reauthRequired) {
    return {
      tone: "warn",
      headline: "Predictions paused: reconnect Twitch",
      detail: status.monitoring
        ? "Matches are still detected, but predictions won't open until you reconnect."
        : "Reconnect Twitch, then start monitoring.",
    };
  }
  if (!status.monitoring) {
    return {
      tone: "off",
      headline: "Monitoring is paused",
      detail: withPresets("Start monitoring to open predictions automatically."),
    };
  }
  if (!status.valorantRunning) {
    return {
      tone: "watching",
      headline: "Waiting for Valorant",
      detail: withPresets("Monitoring runs in the tray while you play."),
    };
  }
  switch (status.localState) {
    case "current_game":
      return {
        tone: "live",
        headline: "Match detected",
        detail: withPresets(`${mode}match in progress.`.replace(/^./, (c) => c.toUpperCase())),
      };
    case "pre_game":
      return {
        tone: "live",
        headline: "Preparing for match",
        detail: withPresets("Valorant is in agent select."),
      };
    case "menus":
      return {
        tone: "watching",
        headline: "Watching for a match",
        detail: withPresets("Valorant is in the menus."),
      };
    default:
      return {
        tone: "watching",
        headline: "Watching Valorant",
        detail: withPresets("Valorant is running."),
      };
  }
}

// Where the current match is, left to right. The track is the one place on the screen
// that follows the game live, so it carries the accent.
const PHASES = ["Menus", "Agent select", "In match", "Result"] as const;

function phaseIndex(status: DetectionStatus): number {
  if (!status.monitoring || !status.valorantRunning) return -1;
  switch (status.localState) {
    case "menus":
      return 0;
    case "pre_game":
      return 1;
    case "current_game":
      return 2;
    case "post_game":
      return 3;
    default:
      return -1;
  }
}

function PhaseTrack({ active }: { active: number }) {
  return (
    <ol className="phase-track" aria-label="Match phase">
      {PHASES.map((label, index) => (
        <li
          key={label}
          className={index === active ? "is-current" : index < active ? "is-past" : ""}
          aria-current={index === active ? "step" : undefined}
        >
          <span className="phase-track__bar" aria-hidden="true" />
          <span className="phase-track__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

interface Props {
  status: DetectionStatus | null;
  onStatus: (status: DetectionStatus) => void;
  presets?: AutoPredictionPreset[];
  /** Twitch refused the saved sign-in (hosted or own app): predictions can't open. */
  reauthRequired?: boolean;
}

export function MonitorSection({ status, onStatus, presets, reauthRequired = false }: Props) {
  const [busy, setBusy] = useState(false);
  const { notice, showError, clear } = useNotice();

  if (!status) {
    return (
      <section className="status-card" aria-busy="true">
        <p className="muted-line">Checking monitoring</p>
      </section>
    );
  }

  const summary = summarize(status, presets, reauthRequired);

  async function toggle() {
    if (!status) return;
    setBusy(true);
    clear();
    try {
      onStatus(
        await (status.monitoring ? companionApi.stopMonitoring() : companionApi.startMonitoring()),
      );
    } catch (error) {
      showError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="status-card">
      <div className="status-card__row">
        <span className={`status-dot ${summary.tone}`} aria-hidden="true" />
        <div className="status-card__text">
          <h1>{summary.headline}</h1>
          <p>{summary.detail}</p>
        </div>
        <button
          type="button"
          className={`button ${status.monitoring ? "secondary" : "primary"}`}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {status.monitoring ? "Stop monitoring" : "Start monitoring"}
        </button>
      </div>
      <PhaseTrack active={phaseIndex(status)} />
      <Notice notice={notice} />
    </section>
  );
}
