import { useState, type FormEvent } from "react";

import { useDashboardMutation } from "../../hooks/useDashboardMutation";
import { api } from "../../lib/api";
import type { AutoPredictionPreset } from "../../types";

export function PresetCard({ preset }: { preset: AutoPredictionPreset }) {
  const label = preset.game_mode === "competitive" ? "Competitive" : "Custom";

  const [enabled, setEnabled] = useState(Boolean(preset.enabled));
  const [titleTemplate, setTitleTemplate] = useState(preset.title_template);
  const [outcomeA, setOutcomeA] = useState(preset.outcome_a);
  const [outcomeB, setOutcomeB] = useState(preset.outcome_b);
  const [predictionWindow, setPredictionWindow] = useState(preset.prediction_window);

  const save = useDashboardMutation(
    (input: {
      enabled: boolean;
      titleTemplate: string;
      outcomeA: string;
      outcomeB: string;
      predictionWindow: number;
    }) => api.savePreset(preset.game_mode, input),
    { successMessage: `${label} preset saved.` },
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({ enabled, titleTemplate, outcomeA, outcomeB, predictionWindow });
  }

  return (
    <form className="card preset-card" onSubmit={handleSubmit}>
      <div className="card-heading">
        <div>
          <span className="card-kicker">{label} mode</span>
          <h2>{label} Preset</h2>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            name="enabled"
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
          name="title_template"
          maxLength={45}
          required
          value={titleTemplate}
          onChange={(event) => setTitleTemplate(event.target.value)}
        />
        <small>
          <code>{"{streamer}"}</code> inserts your Twitch login.
        </small>
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Outcome A</span>
          <input
            name="outcome_a"
            maxLength={25}
            required
            value={outcomeA}
            onChange={(event) => setOutcomeA(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Outcome B</span>
          <input
            name="outcome_b"
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
            name="prediction_window"
            min={30}
            max={1800}
            required
            value={predictionWindow}
            onChange={(event) => setPredictionWindow(Number(event.target.value))}
          />
          <b>seconds</b>
        </div>
      </label>
      <button className="button button-secondary" type="submit" disabled={save.isPending}>
        Save preset
      </button>
    </form>
  );
}
