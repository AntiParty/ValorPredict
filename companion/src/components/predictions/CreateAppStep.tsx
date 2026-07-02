import { useState } from "react";

interface Props {
  redirectUri: string;
  onContinue: () => void;
}

// Step 1: walk the operator through registering their own Twitch application
// (the app is self-hosted, so each operator owns their credentials). The OAuth
// Redirect URL has to match exactly, so we surface it with a one-click copy
// rather than asking people to transcribe it.
export function CreateAppStep({ redirectUri, onContinue }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the URL is still shown to copy by hand.
    }
  }

  return (
    <div className="wizard-step">
      <div className="preset-head">
        <div>
          <span className="card-kicker">Step 1</span>
          <h3>Create your Twitch app</h3>
        </div>
      </div>
      <p className="muted-line">
        Open the Twitch Developer Console and register an application. Use these
        settings when Twitch asks:
      </p>

      <ul className="wizard-facts">
        <li>
          <span>OAuth Redirect URL</span>
          <div className="copy-row">
            <code>{redirectUri}</code>
            <button type="button" className="button ghost" onClick={copyRedirect}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </li>
        <li>
          <span>Category</span>
          <strong>Application Integration</strong>
        </li>
        <li>
          <span>Client Type</span>
          <strong>Confidential</strong>
        </li>
      </ul>

      <a
        className="button secondary wide"
        href="https://dev.twitch.tv/console/apps"
        target="_blank"
        rel="noreferrer"
      >
        Open Twitch Developer Console
      </a>
      <button type="button" className="button primary wide" onClick={onContinue}>
        I&apos;ve created my app
      </button>
    </div>
  );
}
