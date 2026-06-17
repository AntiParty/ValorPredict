import type { SafeUser } from "../../types";
import { TrialCta } from "./TrialCta";

export function FeatureGrid() {
  return (
    <section className="feature-section">
      <div className="section-heading split">
        <div>
          <span className="eyebrow">The product</span>
          <h2>One quiet workflow from queue to prediction.</h2>
        </div>
        <p>
          The companion detects the supported game mode. Your backend chooses the
          matching preset. Twitch gets the prediction.
        </p>
      </div>
      <div className="feature-grid">
        <article className="feature-card">
          <span className="feature-number">01</span>
          <h3>Mode-aware presets</h3>
          <p>
            Give Competitive and Custom games their own title, outcomes, duration, and
            enabled state.
          </p>
        </article>
        <article className="feature-card">
          <span className="feature-number">02</span>
          <h3>Made to stay out of the way</h3>
          <p>
            Close the desktop window and monitoring continues quietly from the Windows
            system tray.
          </p>
        </article>
        <article className="feature-card">
          <span className="feature-number">03</span>
          <h3>A clean backend handoff</h3>
          <p>
            The companion sends only a match-start signal. Prediction creation stays on
            your secure backend.
          </p>
        </article>
      </div>
    </section>
  );
}

export function SafetySection() {
  return (
    <section className="safety-section" id="safety">
      <div className="safety-copy">
        <span className="eyebrow">Safety</span>
        <h2>Read-only by design.</h2>
        <p>
          The desktop companion observes local Riot data and authenticates only to this
          backend. It does not control Valorant and it never receives your Twitch tokens.
        </p>
        <div className="safety-points">
          <span>
            <i>&#10003;</i> Twitch OAuth tokens stay server-side
          </span>
          <span>
            <i>&#10003;</i> Local key can be regenerated anytime
          </span>
          <span>
            <i>&#10003;</i> Unsupported game modes are ignored
          </span>
        </div>
      </div>
      <div className="safety-visual" aria-label="Secure connection model">
        <div>
          <span>Desktop companion</span>
          <small>Local Riot data</small>
        </div>
        <i className="connection-line" />
        <div className="secure-node">
          <span>VAP backend</span>
          <small>Local API key</small>
        </div>
        <i className="connection-line" />
        <div>
          <span>Twitch</span>
          <small>Server-side OAuth</small>
        </div>
      </div>
    </section>
  );
}

export function Workflow() {
  return (
    <section className="workflow-section">
      <div className="section-heading centered">
        <span className="eyebrow">Setup</span>
        <h2>Live in three deliberate steps.</h2>
      </div>
      <div className="workflow-grid">
        <article>
          <span>01</span>
          <h3>Connect Twitch</h3>
          <p>Authorize prediction management through Twitch OAuth.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Choose your presets</h3>
          <p>Configure Competitive and Custom games independently.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Pair the companion</h3>
          <p>Paste your one-time local API key and start monitoring.</p>
        </article>
      </div>
    </section>
  );
}

export function Pricing({ user }: { user: SafeUser | null }) {
  return (
    <section className="pricing-section" id="pricing">
      <div className="section-heading centered">
        <span className="eyebrow">Simple pricing</span>
        <h2>One plan. Every supported match.</h2>
        <p>
          No feature maze, usage tiers, or free plan that stops working when your stream
          grows.
        </p>
      </div>
      <div className="pricing-card">
        <div className="price-top">
          <span>Creator</span>
          <b>7-day free trial</b>
        </div>
        <div className="price">
          <strong>$9</strong>
          <span>/ month</span>
        </div>
        <p>
          Automatic Twitch predictions for streamers who would rather focus on the game.
        </p>
        <ul>
          <li>Competitive and Custom presets</li>
          <li>Windows desktop companion</li>
          <li>Unlimited prediction triggers</li>
          <li>Activity history and live status</li>
        </ul>
        <TrialCta user={user} className="button button-light button-large wide" withArrow />
        <small>Cancel anytime.</small>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="faq-section" id="faq">
      <div className="section-heading split">
        <div>
          <span className="eyebrow">FAQ</span>
          <h2>Frequently asked questions</h2>
        </div>
        <p>The practical details before you connect a channel.</p>
      </div>
      <div className="faq-list">
        <details open>
          <summary>Does the companion access my Twitch account?</summary>
          <p>
            No. It authenticates to the VAP backend with a revocable local API key.
            Twitch tokens remain on the server.
          </p>
        </details>
        <details>
          <summary>Which game modes are supported?</summary>
          <p>
            Competitive and Custom games can each have a dedicated preset. Other modes are
            ignored.
          </p>
        </details>
        <details>
          <summary>Does it keep running after I close the window?</summary>
          <p>
            Yes. Closing the window minimizes the companion to the system tray. Fully
            quitting is available from the tray menu.
          </p>
        </details>
        <details>
          <summary>Can I test it before real detection runs?</summary>
          <p>
            Yes. Development mode includes match simulators so you can verify both presets
            end to end.
          </p>
        </details>
      </div>
    </section>
  );
}

export function FinalCta({ user }: { user: SafeUser | null }) {
  return (
    <section className="final-cta">
      <span className="eyebrow">Ready when your match is</span>
      <h2>Make channel engagement automatic.</h2>
      <p>
        Connect Twitch, pair the companion, and let your next supported match do the rest.
      </p>
      <TrialCta user={user} className="button button-light button-large" withArrow />
    </section>
  );
}
