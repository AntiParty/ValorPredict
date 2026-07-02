import { type CSSProperties } from "react";

import { Brand } from "../components/Brand";

const panel: CSSProperties = { maxWidth: 480, margin: "72px auto", textAlign: "center" };

export function Connect() {
  return (
    <main className="dashboard-shell">
      <section className="card" style={panel}>
        <Brand />
        <div className="card-heading">
          <div>
            <span className="card-kicker">Almost there</span>
            <h2>Connect your Twitch account</h2>
          </div>
        </div>
        <p>
          Authorize prediction management so the app can open and resolve
          predictions automatically when a match starts.
        </p>
        {/* Full navigation (not a fetch): the server redirects to Twitch and
            back to /dashboard, where the SPA reloads signed in. */}
        <a className="button button-primary button-large wide" href="/auth/twitch">
          Connect Twitch
        </a>
      </section>
    </main>
  );
}
