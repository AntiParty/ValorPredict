import { useState, type FormEvent } from "react";

import { useDashboardMutation } from "../../hooks/useDashboardMutation";
import { api } from "../../lib/api";
import type { DashboardData } from "../../types";
import { CopyRow } from "../CopyRow";

interface ShoutoutRow {
  riotId: string;
  display: string;
}

const BLANK_ROW: ShoutoutRow = { riotId: "", display: "" };

export function DuoCommandCard({ duo }: { duo: DashboardData["duo"] }) {
  const { config, shoutouts, url } = duo;

  const [enabled, setEnabled] = useState(Boolean(config.enabled));
  const [template, setTemplate] = useState(config.template);
  const [fallbackText, setFallbackText] = useState(config.fallback_text);
  const [rows, setRows] = useState<ShoutoutRow[]>([
    ...shoutouts.map((shoutout) => ({
      riotId: shoutout.riot_id,
      display: shoutout.display,
    })),
    { ...BLANK_ROW },
    { ...BLANK_ROW },
  ]);

  const save = useDashboardMutation(
    (input: {
      enabled: boolean;
      template: string;
      fallbackText: string;
      shoutouts: ShoutoutRow[];
    }) => api.saveDuo(input),
    { successMessage: "Duo command saved." },
  );

  const regenerate = useDashboardMutation(() => api.regenerateDuo(), {
    successMessage: "Public URL regenerated.",
  });

  function updateRow(index: number, patch: Partial<ShoutoutRow>) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = rows
      .map((row) => ({ riotId: row.riotId.trim(), display: row.display.trim() }))
      .filter((row) => row.riotId.length > 0);
    save.mutate({ enabled, template, fallbackText, shoutouts: cleaned });
  }

  return (
    <section className="card duo-card">
      <div className="card-heading">
        <div>
          <span className="card-kicker">Beta · Chatbot</span>
          <h2>Duo Command</h2>
        </div>
        <span className={`status-pill ${enabled ? "ready" : ""}`}>
          <i />
          {enabled ? "Live" : "Off"}
        </span>
      </div>
      <p>
        Publish who you are queued with to a plain-text URL your chatbot can read. The
        companion respects Incognito and only shares your current party.
      </p>
      <div className="duo-url">
        <span>Public URL</span>
        <CopyRow value={url} inputId="duo-url" />
        <small>
          Nightbot: <code>!addcom !duo $(urlfetch {url})</code>
        </small>
      </div>
      <div className="duo-regenerate">
        <button
          className="button button-secondary"
          type="button"
          disabled={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          Regenerate URL
        </button>
        <small>Invalidates the old URL. Update your chatbot command afterwards.</small>
      </div>
      <form className="duo-settings" onSubmit={handleSubmit}>
        <label className="toggle duo-toggle">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span aria-hidden="true" />
          <strong>{enabled ? "On" : "Off"}</strong>
        </label>
        <label className="field">
          <span>Command message</span>
          <input
            name="template"
            maxLength={120}
            required
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          />
          <small>
            <code>{"{names}"}</code> inserts your party members.
          </small>
        </label>
        <label className="field">
          <span>Fallback (solo or hidden)</span>
          <input
            name="fallback_text"
            maxLength={120}
            required
            value={fallbackText}
            onChange={(event) => setFallbackText(event.target.value)}
          />
        </label>
        <fieldset className="duo-shoutouts">
          <legend>Per-player shoutouts</legend>
          <p className="field-note">
            Override how a specific Riot ID is shown. Leave blank to use their name.
          </p>
          {rows.map((row, index) => (
            <div className="field-grid duo-shoutout-row" key={index}>
              <label className="field">
                <span>Riot ID</span>
                <input
                  maxLength={64}
                  placeholder="Name#TAG"
                  value={row.riotId}
                  onChange={(event) => updateRow(index, { riotId: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Shoutout</span>
                <input
                  maxLength={120}
                  placeholder="the legend Name (follow @name)"
                  value={row.display}
                  onChange={(event) => updateRow(index, { display: event.target.value })}
                />
              </label>
            </div>
          ))}
        </fieldset>
        <button className="button button-primary" type="submit" disabled={save.isPending}>
          Save duo command
        </button>
      </form>
    </section>
  );
}
