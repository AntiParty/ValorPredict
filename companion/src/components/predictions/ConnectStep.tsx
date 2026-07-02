import { useState } from "react";

import { companionApi } from "../../api";

// Step 3: authorize the saved Twitch app. The browser opens for sign-in and
// returns here; on success the backend reports a `user` and the wizard hands
// off to the main workspace.
export function ConnectStep({ onConnected }: { onConnected: () => void }) {
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
        Channel Points Predictions automatically when a match starts. Your
        browser opens for sign-in and returns here.
      </p>
      {error && <div className="pred-notice error">{error}</div>}
      <button className="button primary wide" type="button" disabled={busy} onClick={connect}>
        {busy ? "Waiting for Twitch…" : "Connect Twitch"}
      </button>
    </div>
  );
}
