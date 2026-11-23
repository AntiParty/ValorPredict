import { describe, expect, it } from "vitest";

import { formatRelative, initials, parseTimestamp, renderTitle } from "./format";

describe("renderTitle", () => {
  it("fills in the streamer's login", () => {
    expect(renderTitle("Will {streamer} win this match?", "antiparty")).toBe(
      "Will antiparty win this match?",
    );
  });

  it("replaces every placeholder and leaves other braces alone", () => {
    expect(renderTitle("{streamer}: {streamer} vs {map}", "ap")).toBe("ap: ap vs {map}");
  });

  it("returns a template without a placeholder unchanged", () => {
    expect(renderTitle("Win or lose?", "ap")).toBe("Win or lose?");
  });
});

describe("parseTimestamp", () => {
  it("reads SQLite timestamps (no zone) as UTC", () => {
    expect(parseTimestamp("2026-10-02 01:35:10")?.toISOString()).toBe("2026-10-02T01:35:10.000Z");
  });

  it("reads RFC 3339 timestamps as written", () => {
    expect(parseTimestamp("2026-10-02T03:35:10+02:00")?.toISOString()).toBe(
      "2026-10-02T01:35:10.000Z",
    );
  });

  it("returns null for empty or invalid input", () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("not a date")).toBeNull();
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it.each([
    [0, "just now"],
    [30_000, "just now"],
    [60_000, "1 min ago"],
    [5 * 60_000, "5 min ago"],
    [59 * 60_000, "59 min ago"],
    [60 * 60_000, "1 h ago"],
    [5 * 3_600_000, "5 h ago"],
    [24 * 3_600_000, "1 d ago"],
    [3 * 24 * 3_600_000, "3 d ago"],
  ])("%d ms ago reads %s", (ms, expected) => {
    expect(formatRelative(ago(ms), now)).toBe(expected);
  });

  it("falls back to the date after a week", () => {
    const value = ago(8 * 24 * 3_600_000);
    expect(formatRelative(value, now)).toBe(new Date(value).toLocaleDateString());
  });

  it("never reports a future time as negative", () => {
    expect(formatRelative(ago(-5 * 60_000), now)).toBe("just now");
  });

  it("handles missing and unparseable values", () => {
    expect(formatRelative(null, now)).toBe("Not yet");
    expect(formatRelative("garbage", now)).toBe("garbage");
  });

  it("reads SQLite timestamps as UTC, not local time", () => {
    expect(formatRelative("2026-10-02 11:55:00", now)).toBe("5 min ago");
  });
});

describe("initials", () => {
  it("uses the first letters of up to two words", () => {
    expect(initials("anti_party")).toBe("AP");
    expect(initials("")).toBe("U");
  });
});
