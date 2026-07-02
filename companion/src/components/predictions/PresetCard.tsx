import { useEffect, useState, type FormEvent } from "react";

import type { AutoPredictionPreset, PresetInput } from "../../types";

interface Props {
  preset: AutoPredictionPreset;
  busy: boolean;
  onSave: (input: PresetInput) => void;
}

export function PresetCard({ preset, busy, onSave }: Props) {
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(currentInput());
    setEditing(false);
  }

  // Toggle on/off straight from the collapsed row — the common daily action —
  // without opening the form.
  function toggleEnabled(next: boolean) {
    setEnabled(next);
    onSave({ ...currentInput(), enabled: next });
  }

  if (!editing) {
    return (
      <div className={`preset-row ${enabled ? "is-on" : ""}`}>
        <div className="preset-row__main">
          <span className="card-kicker">{label}</span>
          <strong className="preset-row__title">{titleTemplate}</strong>
        </div>
        <label className="toggle" title={enabled ? "Enabled" : "Disabled"}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => toggleEnabled(event.target.checked)}
          />
          <span aria-hidden="true" />
          <strong>{enabled ? "On" : "Off"}</strong>
        </label>
        <button type="button" className="button ghost" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }

  return (
    <form className="card preset-card" onSubmit={handleSubmit}>
      <div className="preset-head">
        <div>
          <span className="card-kicker">{label} mode</span>
          <h3>{label} Preset</h3>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span aria-hidden="true" />
          <strong>{enabled ? "On" : "Off"}</strong>
        </label>
      </div>

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
