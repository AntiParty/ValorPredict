import { useState, type FormEvent } from "react";

import { companionApi } from "../../api";

interface Props {
  onConnected: () => void;
  /** Reconnecting after Twitch refused the saved sign-in (changes the wording). */
  reconnect?: boolean;
  /** Onboarding only: switch to registering the streamer's own Twitch application. */
  onUseOwnApp?: () => void;
}

// Hosted sign-in: no Twitch developer account needed. The streamer signs in on
// ValorPredict's web page, copies a hidden connection code, and the app reads it
// from the clipboard on the Rust side, so the code never enters this webview.
export function HostedConnectStep({ onConnected, reconnect = false, onUseOwnApp }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");

  async function attempt(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onConnected();
    } catch (caught) {
      setError(String(caught));
    } finally {
      // Never keep the pasted code around, whether it worked or not.
      setCode("");
      setBusy(false);
    }
  }

  async function openSignIn() {
    setError("");
    try {
      await companionApi.startHostedLogin();
    } catch (caught) {
      setError(String(caught));
    }
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pasted = code;
    void attempt(() => companionApi.importConnectionCode(pasted));
  }

  return (
    <div className="wizard-step">
      <div className="preset-head">
        <div>
          <span className="card-kicker">{reconnect ? "Reconnect" : "Connect"}</span>
          <h3>{reconnect ? "Reconnect your Twitch account" : "Connect your Twitch account"}</h3>
        </div>
      </div>
      <p className="muted-line">
        {reconnect
          ? "Your Twitch sign-in expired, so predictions are paused. Sign in again to resume."
          : "Authorize prediction management so ValorPredict can open and resolve Channel Points Predictions for you. Twitch Predictions require an Affiliate or Partner account."}
      </p>

      <ol className="connect-steps">
        <li>
          <div>
            <strong>Sign in with Twitch</strong>
            <p className="muted-line">
              Opens your browser. After you approve, the page shows a hidden
              connection code with a Copy button.
            </p>
          </div>
          <button className="button primary" type="button" disabled={busy} onClick={openSignIn}>
            Connect Twitch
          </button>
        </li>
        <li>
          <div>
            <strong>Paste the code here</strong>
            <p className="muted-line">
              Come back to this window and paste. The code expires after 10 minutes.
            </p>
          </div>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void attempt(companionApi.importConnectionCodeFromClipboard)}
          >
            {busy ? "Connecting…" : "Paste from clipboard"}
          </button>
        </li>
      </ol>

      {error && <div className="pred-notice error" role="alert">{error}</div>}

      <details
        className="more-disclosure"
        open={manual}
        onToggle={(event) => setManual(event.currentTarget.open)}
      >
        <summary>Paste manually</summary>
        <form onSubmit={submitManual}>
          <label className="field">
            <span>Connection code</span>
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="vp1_…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <button className="button secondary" type="submit" disabled={busy || !code.trim()}>
            Connect
          </button>
        </form>
      </details>

      <p className="field-note">
        ValorPredict never sees your Twitch password. Sign-in goes through
        ValorPredict&apos;s small open-source sign-in service, which holds the
        app&apos;s Twitch secret so you don&apos;t need a developer account. It
        stores nothing, and the code is cleared from your clipboard after use.
      </p>

      {onUseOwnApp && (
        <p className="field-note">
          Prefer not to use it?{" "}
          <button className="link-button" type="button" onClick={onUseOwnApp}>
            Use my own Twitch application
          </button>
        </p>
      )}
    </div>
  );
}
