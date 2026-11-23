import { useEffect, useState, type FormEvent } from "react";

import { renderTitle } from "../../format";
import { useNotice } from "../../hooks/useNotice";
import type { AutoPredictionPreset, PresetInput } from "../../types";
import { Notice } from "../Notice";

interface Props {
  preset: AutoPredictionPreset;
  /** The streamer's Twitch login, shown in place of `{streamer}`. */
  login: string;
  busy: boolean;
  /** Rejects when the save fails, so the editor can stay open and say why. */
  onSave: (input: PresetInput) => Promise<void>;
}

export function PresetCard({ preset, login, busy, onSave }: Props) {
  const label = preset.game_mode === "competitive" ? "Competitive" : "Custom";

  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(Boolean(preset.enabled));
  const [titleTemplate, setTitleTemplate] = useState(preset.title_template);
  const [outcomeA, setOutcomeA] = useState(preset.outcome_a);
  const [outcomeB, setOutcomeB] = useState(preset.outcome_b);
  const [predictionWindow, setPredictionWindow] = useState(preset.prediction_window);
  const [winOutcome, setWinOutcome] = useState<"A" | "B">(
    preset.win_outcome === "B" ? "B" : "A",
  );
  const { notice, showSuccess, showError, clear } = useNotice();

  // Sync from the server only while not mid-edit, so a background refresh can't
  // clobber what the user is typing.
  useEffect(() => {
    if (editing) return;
    setEnabled(Boolean(preset.enabled));
    setTitleTemplate(preset.title_template);
    setOutcomeA(preset.outcome_a);
    setOutcomeB(preset.outcome_b);
    setPredictionWindow(preset.prediction_window);
    setWinOutcome(preset.win_outcome === "B" ? "B" : "A");
  }, [preset, editing]);

  const currentInput = (): PresetInput => ({
    enabled,
    titleTemplate,
    outcomeA,
    outcomeB,
    predictionWindow,
    winOutcome,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();
    try {
      await onSave(currentInput());
      setEditing(false);
      showSuccess(`${label} preset saved.`);
    } catch (error) {
      showError(String(error));
    }
  }

  // Toggle on/off straight from the collapsed row (the common daily action)
  // without opening the form. A failed save puts the switch back.
  async function toggleEnabled(next: boolean) {
    clear();
    setEnabled(next);
    try {
      await onSave({ ...currentInput(), enabled: next });
    } catch (error) {
      setEnabled(!next);
      showError(String(error));
    }
  }

  if (!editing) {
    return (
      <div className="preset-item">
        <div className={`preset-row ${enabled ? "is-on" : ""}`}>
          <strong className="preset-row__label">{label}</strong>
          <span className="preset-row__title" title={renderTitle(titleTemplate, login)}>
            {renderTitle(titleTemplate, login)}
          </span>
          <label className="toggle">
            <input
              type="checkbox"
              aria-label={`${label} preset`}
              checked={enabled}
              disabled={busy}
              onChange={(event) => void toggleEnabled(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>{enabled ? "On" : "Off"}</strong>
          </label>
          <button
            type="button"
            className="button ghost"
            aria-label={`Edit ${label} preset`}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </div>
        <Notice notice={notice} />
      </div>
    );
  }

  return (
    <form className="card preset-card" onSubmit={(event) => void handleSubmit(event)}>
      <h3>{label} preset</h3>

      <label className="field">
        <span>Prediction title</span>
        <input
          maxLength={45}
          required
          value={titleTemplate}
          onChange={(event) => setTitleTemplate(event.target.value)}
        />
        <small>
          <code>{"{streamer}"}</code> inserts your Twitch login.
        </small>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Outcome A</span>
          <input
            maxLength={25}
            required
            value={outcomeA}
            onChange={(event) => setOutcomeA(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Outcome B</span>
          <input
            maxLength={25}
            required
            value={outcomeB}
            onChange={(event) => setOutcomeB(event.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span>Prediction duration</span>
        <div className="number-field">
          <input
            type="number"
            min={30}
            max={1800}
            required
            value={predictionWindow}
            onChange={(event) => setPredictionWindow(Number(event.target.value))}
          />
          <b>seconds</b>
        </div>
      </label>

      <label className="field">
        <span>Winning outcome (auto-pays this side when you win)</span>
        <select
          className="select-field"
          value={winOutcome}
          onChange={(event) => setWinOutcome(event.target.value === "B" ? "B" : "A")}
        >
          <option value="A">Outcome A — {outcomeA || "A"}</option>
          <option value="B">Outcome B — {outcomeB || "B"}</option>
        </select>
        <small>When the match ends, the companion resolves to this side if you won, the other side if you lost.</small>
      </label>

      <Notice notice={notice} />
      <div className="preset-actions">
        <button
          type="button"
          className="button ghost"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
        <button className="button secondary" type="submit" disabled={busy}>
          Save preset
        </button>
      </div>
    </form>
  );
}
