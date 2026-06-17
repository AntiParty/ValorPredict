import type { SafeUser } from "../../types";
import { Brand } from "../Brand";
import { TrialCta } from "./TrialCta";

export function LandingHeader({ user }: { user: SafeUser | null }) {
  return (
    <header className="site-header">
      <div className="nav-wrap">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#safety">Safety</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="nav-actions">
          {user ? null : (
            <a className="nav-login" href="/auth/twitch">
              Log in
            </a>
          )}
          <TrialCta user={user} className="button button-light button-small" />
        </div>
      </div>
    </header>
  );
}
