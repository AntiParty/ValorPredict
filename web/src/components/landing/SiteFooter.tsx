import { Brand } from "../Brand";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand />
      <span>Automatic Twitch predictions for Valorant streamers.</span>
      <nav aria-label="Footer navigation">
        <a href="#safety">Safety</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
      </nav>
    </footer>
  );
}
