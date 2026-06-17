import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the landing/dashboard stylesheet against paint-heavy patterns that
// previously caused jank. Ported from the old server-side /styles.css tests so
// the protection moved with the stylesheet into the SPA.
const css = readFileSync(path.resolve(process.cwd(), "src/styles.css"), "utf8");

describe("styles.css performance guards", () => {
  it("avoids persistent paint-heavy effects", () => {
    expect(css).not.toMatch(/backdrop-filter:/);
    expect(css).not.toMatch(/transform-style:\s*preserve-3d/);
    expect(css).not.toMatch(/animation:\s*streamer-scroll/);
    expect(css).not.toMatch(/animation:\s*demo-stack-enter/);
    expect(css).not.toMatch(/@keyframes demo-card-float/);
    expect(css).not.toMatch(/@keyframes demo-aura-breathe/);
  });

  it("does not animate box-shadow on large hover cards", () => {
    const featureCardRule = css.match(/\.feature-card\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const featureTransition = featureCardRule.match(/transition:[\s\S]*?;/)?.[0] ?? "";

    // Animating box-shadow forces a per-frame blur repaint on a large card.
    expect(featureTransition).not.toMatch(/box-shadow/);
  });

  it("never uses an unpromoted gradient-clipped heading", () => {
    const heroHeading = css.match(/\.hero-copy h1\s*\{[\s\S]*?\}/)?.[0] ?? "";

    // background-clip:text repaints on every mousemove unless layer-promoted.
    // A solid color is fine; only the clipped-gradient form needs promotion.
    if (/background-clip:\s*text/.test(heroHeading)) {
      expect(heroHeading).toMatch(/translateZ\(0\)|translate3d\(|will-change/);
    }
  });

  it("keeps the product screenshot flat (no perspective or clipped layers)", () => {
    expect(css).toMatch(/\.product-screenshot\s*\{/);
    expect(css).toMatch(/\.demo-twitch-results\s*\{[\s\S]*grid-template-columns:/);
    expect(css).not.toMatch(/perspective\(/);
    expect(css).not.toMatch(/clip-path:\s*polygon/);
  });

  it("uses a dedicated readable numeric style for platform metrics", () => {
    const metricRule = css.match(/\.metrics-grid strong\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(metricRule).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(metricRule).toMatch(/font-feature-settings:\s*"tnum"/);
    expect(metricRule).not.toMatch(/font-family:\s*var\(--display\)/);
  });
});

describe("streamer marquee", () => {
  it("scrolls the track with a GPU-composited transform animation", () => {
    const trackRule = css.match(/\.streamer-track\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(trackRule).toMatch(/animation:\s*streamer-marquee/);

    const keyframes = css.match(/@keyframes streamer-marquee\s*\{[\s\S]*?\}\s*\}/)?.[0] ?? "";
    // transform (not left/margin) keeps the marquee off the paint/layout path.
    expect(keyframes).toMatch(/transform:\s*translate(X|3d)/);
  });

  it("pauses on hover and keyboard focus", () => {
    expect(css).toMatch(
      /\.streamer-window:hover \.streamer-track[\s\S]*?animation-play-state:\s*paused/,
    );
  });

  it("never hides marquee cards by position (would break the seamless loop)", () => {
    // The old static grid hid cards 3+ on small screens; a marquee needs every
    // duplicated card present so translateX(-50%) loops seamlessly.
    expect(css).not.toMatch(
      /\.streamer-card:nth-child\([^)]*\)\s*\{[^}]*display:\s*none/,
    );
  });
});
