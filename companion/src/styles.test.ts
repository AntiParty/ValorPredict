import { describe, expect, it } from "vitest";

import styles from "./styles.css?raw";

describe("desktop layout constraints", () => {
  it("supports the 560px companion window without the old 720px floor", () => {
    expect(styles).not.toMatch(/body\s*\{[^}]*min-width:\s*720px/s);
    expect(styles).toMatch(/body\s*\{[^}]*min-width:\s*560px/s);
    expect(styles).toContain("@media (max-width: 700px)");
  });

  it("provides a visible keyboard focus treatment", () => {
    expect(styles).toContain(":focus-visible");
  });

  it("uses a solid minimal workspace without decorative viewport layers", () => {
    expect(styles).toMatch(/body\s*\{[^}]*background:\s*#090a0c/s);
    expect(styles).not.toContain("body::before");
    expect(styles).not.toContain("body::after");
    expect(styles).toContain(".more-disclosure");
    expect(styles).toContain(".diagnostics-disclosure");
  });
});
