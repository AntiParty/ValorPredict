import { useState, type FormEvent } from "react";

import { companionApi } from "../../api";

interface Props {
  redirectUri: string;
  onSaved: () => void;
}

// Step 2: paste the Client ID + Secret from the app created in step 1. Stored
// only on this PC. Saving flips the backend's `configured` flag, which advances
// the wizard to the Connect step.
export function CredentialsStep({ redirectUri, onSaved }: Props) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await companionApi.saveTwitchCredentials(clientId.trim(), clientSecret.trim());
      onSaved();
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
          <span className="card-kicker">Step 2</span>
          <h3>Paste your keys</h3>
        </div>
      </div>
      <p className="muted-line">
        Open your app in the Twitch console and copy its Client ID and Secret.
        They are stored only on this PC.
      </p>
      {error && <div className="pred-notice error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <label className="field">
          <span>Client ID</span>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="From your Twitch app's main page"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>Client Secret</span>
          <input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder="Click 'New Secret' in the Twitch console"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <button className="button primary wide" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </button>
      </form>
      <p className="field-note">
        Redirect URL must match exactly: <code>{redirectUri}</code>
      </p>
    </div>
  );
}
