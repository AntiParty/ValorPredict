import { useState, type FormEvent } from "react";

import { companionApi } from "../../api";
import { Notice } from "../Notice";

interface Props {
  onConnected: () => void;
  /**
   * Reconnecting after Twitch refused the saved sign-in: a full-width compact panel
   * for the dashboard, without the long trust text (that stays in onboarding).
   */
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

  const errorNotice = <Notice notice={error ? { kind: "error", message: error } : null} />;

  if (reconnect) {
    return (
      <section className="card reconnect-panel">
        <div className="reconnect-panel__row">
          <div>
            <h2>Reconnect your Twitch account</h2>
            <p className="muted-line">
              Your Twitch sign-in expired, so predictions are paused. Sign in with
              Twitch in your browser, then paste the code here.
            </p>
          </div>
          <div className="reconnect-panel__actions">
            <button className="button primary" type="button" disabled={busy} onClick={openSignIn}>
              Connect Twitch
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => void attempt(companionApi.importConnectionCodeFromClipboard)}
            >
              {busy ? "Connecting…" : "Paste from clipboard"}
            </button>
          </div>
        </div>
        {errorNotice}
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
      </section>
    );
  }

  return (
    <div className="wizard-step">
      <h3>Connect your Twitch account</h3>
      <p className="muted-line">
        Authorize prediction management so ValorPredict can open and resolve
        Channel Points Predictions for you. Twitch Predictions require an
        Affiliate or Partner account.
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

      {errorNotice}

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
