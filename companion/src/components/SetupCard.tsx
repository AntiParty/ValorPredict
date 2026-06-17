import { useEffect, useState } from "react";

import type { SettingsView } from "../types";

interface Props {
  settings: SettingsView;
  busy: boolean;
  onSave: (
    backendUrl: string,
    localApiKey: string,
    pollInterval: number,
  ) => Promise<void>;
  onTest: () => Promise<void>;
}

export function SetupCard({ settings, busy, onSave, onTest }: Props) {
  const [backendUrl, setBackendUrl] = useState(settings.backendUrl);
  const [localApiKey, setLocalApiKey] = useState("");
  const [pollInterval, setPollInterval] = useState(
    settings.pollIntervalSeconds,
  );

  useEffect(() => {
    setBackendUrl(settings.backendUrl);
    setPollInterval(settings.pollIntervalSeconds);
  }, [settings]);

  return (
    <section className="panel setup-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Connection profile</span>
          <h2>Backend Setup</h2>
        </div>
        <span className={`pill ${settings.hasLocalApiKey ? "good" : "warn"}`}>
          {settings.hasLocalApiKey ? "Key stored" : "Key required"}
        </span>
      </div>

      <label>
        <span>Backend API URL</span>
        <input
          value={backendUrl}
          onChange={(event) => setBackendUrl(event.target.value)}
          spellCheck={false}
        />
      </label>
      <label>
        <span>Local API Key</span>
        <input
          type="password"
          value={localApiKey}
          onChange={(event) => setLocalApiKey(event.target.value)}
          placeholder={
            settings.hasLocalApiKey
              ? `${settings.localApiKeyMasked} (leave blank to keep)`
              : "Paste the vap_ key from the web dashboard"
          }
          autoComplete="off"
          spellCheck={false}
        />
        <small>The key stays on this PC and is never written to the debug log.</small>
      </label>
      <label>
        <span>Polling interval</span>
        <div className="range-row">
          <input
            type="range"
            min="3"
            max="5"
            value={pollInterval}
            onChange={(event) => setPollInterval(Number(event.target.value))}
          />
          <strong>{pollInterval}s</strong>
        </div>
      </label>
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => onSave(backendUrl, localApiKey, pollInterval)}
        >
          Save Settings
        </button>
        <button className="button secondary" disabled={busy} onClick={onTest}>
          Test Connection
        </button>
      </div>
    </section>
  );
}
