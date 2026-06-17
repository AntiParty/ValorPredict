import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  resolve(process.cwd(), "src/styles.css"),
  "utf8",
);

describe("streamer rail animation", () => {
  it("uses a slow marquee that pauses on interaction and respects reduced motion", () => {
    expect(styles).toContain("animation: streamer-marquee");
    expect(styles).toContain("@keyframes streamer-marquee");
    expect(styles).toContain(".streamer-window:hover .streamer-track");
    expect(styles).toContain(".streamer-window:focus-within .streamer-track");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("animation: none");
  });
});
