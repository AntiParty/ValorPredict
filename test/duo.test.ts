import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DUO_FALLBACK,
  DEFAULT_DUO_TEMPLATE,
  renderDuoText,
} from "../src/duo.js";

const FRESH = "2030-01-01T00:00:00.000Z";
const NOW = new Date(FRESH).getTime() + 5_000;

function baseInput(overrides: Partial<Parameters<typeof renderDuoText>[0]> = {}) {
  return {
    template: DEFAULT_DUO_TEMPLATE,
    fallbackText: DEFAULT_DUO_FALLBACK,
    inParty: true,
    members: [
      { riotId: "TenZ#NA1", name: "TenZ" },
      { riotId: "Shroud#000", name: "Shroud" },
    ],
    shoutouts: {},
    updatedAt: FRESH,
    now: NOW,
    ...overrides,
  };
}

test("renders queued duo names into the {names} template", () => {
  assert.equal(renderDuoText(baseInput()), "Currently queued with: TenZ, Shroud");
});

test("applies per-Riot-ID shoutout display overrides", () => {
  const text = renderDuoText(
    baseInput({
      template: "{names}",
      shoutouts: { "TenZ#NA1": "the legend TenZ (follow @tenz)" },
    }),
  );
  assert.equal(text, "the legend TenZ (follow @tenz), Shroud");
});

test("falls back when the companion reports no party", () => {
  assert.equal(
    renderDuoText(baseInput({ inParty: false })),
    DEFAULT_DUO_FALLBACK,
  );
});

test("falls back when there are no visible members (solo or all incognito)", () => {
  assert.equal(
    renderDuoText(baseInput({ members: [] })),
    DEFAULT_DUO_FALLBACK,
  );
});

test("falls back when the snapshot is stale", () => {
  const stale = new Date(FRESH).getTime() + 11 * 60 * 1000;
  assert.equal(
    renderDuoText(baseInput({ now: stale })),
    DEFAULT_DUO_FALLBACK,
  );
});

test("falls back when there is no snapshot timestamp", () => {
  assert.equal(
    renderDuoText(baseInput({ updatedAt: null })),
    DEFAULT_DUO_FALLBACK,
  );
});

test("caps output length for $(urlfetch) consumers", () => {
  const members = Array.from({ length: 5 }, (_, index) => ({
    riotId: `Player${index}#EU`,
    name: "X".repeat(120),
  }));
  const text = renderDuoText(baseInput({ members, maxLength: 200 }));
  assert.ok(text.length <= 200, `expected <=200, got ${text.length}`);
  assert.ok(text.endsWith("…"));
});

test("uses a custom template verbatim around the names", () => {
  const text = renderDuoText(
    baseInput({ template: "Duo today: {names} <3" }),
  );
  assert.equal(text, "Duo today: TenZ, Shroud <3");
});
