import { describe, expect, it } from "vitest";

import { formatDate, formatMetric, streamerInitials } from "./format";

describe("formatMetric", () => {
  it("renders large numbers in compact notation", () => {
    expect(formatMetric(1240)).toBe("1.2K");
    expect(formatMetric(5)).toBe("5");
  });
});

describe("streamerInitials", () => {
  it("takes the first letter of up to two words, uppercased", () => {
    expect(streamerInitials("ace")).toBe("A");
    expect(streamerInitials("Pixel Vandal")).toBe("PV");
    expect(streamerInitials("alpha_victor_papa")).toBe("AV");
  });
});

describe("formatDate", () => {
  it("returns a fallback for empty values", () => {
    expect(formatDate(null)).toBe("Not yet");
    expect(formatDate(undefined)).toBe("Not yet");
  });

  it("passes through unparseable values unchanged", () => {
    expect(formatDate("not a date")).toBe("not a date");
  });
});
