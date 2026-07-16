import { useState } from "react";

import { companionApi } from "../../api";

interface Props {
  onConnected: () => void;
  onEditCredentials: () => void;
}

export function ConnectStep({ onConnected, onEditCredentials }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    try {
      await companionApi.connectTwitch();
      onConnected();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard-step">
      <div className="preset-head">
        <div>
          <span className="card-kicker">Step 3</span>
          <h3>Connect your Twitch account</h3>
        </div>
      </div>
      <p className="muted-line">
        Authorize prediction management so the companion can open and resolve
        Channel Points Predictions automatically. Twitch Predictions require an
        Affiliate or Partner account.
      </p>
      <p className="field-note">
        Your browser will open for sign-in. When Twitch confirms the connection,
        close that tab and return to ValorPredict.
      </p>
      {error && <div className="pred-notice error">{error}</div>}
      <div className="wizard-actions">
        <button
          className="button ghost"
          type="button"
          disabled={busy}
          onClick={onEditCredentials}
        >
          Edit credentials
        </button>
        <button className="button primary" type="button" disabled={busy} onClick={connect}>
          {busy ? "Waiting for Twitch…" : "Connect Twitch"}
        </button>
      </div>
    </div>
  );
}
