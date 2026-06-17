import type { SafeUser } from "../../types";
import { TrialCta } from "./TrialCta";

function AutomationDemo() {
  return (
    <div
      className="automation-demo"
      id="product"
      aria-label="Example of a prediction created automatically"
    >
      <div className="product-screenshot">
        <span className="twitch-system">
          <i aria-hidden="true">&#10022;</i> Prediction started automatically
        </span>
        <div className="demo-twitch-question">
          <strong>Will ace win this Valorant match?</strong>
        </div>
        <div className="demo-twitch-results">
          <div className="demo-twitch-blue">
            <span>Yes</span>
          </div>
          <div className="demo-twitch-pink">
            <span>No</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingHero({ user }: { user: SafeUser | null }) {
  return (
    <section className="landing-hero">
      <div className="hero-copy reveal-one">
        <span className="eyebrow">Valorant Auto Predictions</span>
        <h1>Automatic predictions. Zero interruptions.</h1>
        <p>
          <strong>Predictions that start when your match does.</strong> Turn every
          supported Valorant match into a Twitch engagement moment without leaving the
          game.
        </p>
        <div className="hero-actions">
          <TrialCta user={user} className="button button-light button-large" withArrow />
          <a className="button button-quiet button-large" href="#product">
            Explore product
          </a>
        </div>
        <p className="trial-note">7-day free trial. Then $9/month. Cancel anytime.</p>
      </div>
      <AutomationDemo />
    </section>
  );
}
