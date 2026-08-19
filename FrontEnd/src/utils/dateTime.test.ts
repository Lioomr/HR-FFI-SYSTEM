import { describe, it, expect } from "vitest";
import { formatDurationBetween } from "./dateTime";

describe("formatDurationBetween", () => {
  it("formats hours and minutes", () => {
    expect(
      formatDurationBetween("2026-08-11T05:00:00Z", "2026-08-11T13:30:00Z"),
    ).toBe("8h 30m");
  });

  it("formats sub-hour ranges in minutes only", () => {
    expect(
      formatDurationBetween("2026-08-11T05:00:00Z", "2026-08-11T05:45:00Z"),
    ).toBe("45m");
  });

  it("falls back when either bound is missing", () => {
    expect(formatDurationBetween(null, "2026-08-11T13:30:00Z")).toBe("-");
    expect(formatDurationBetween("2026-08-11T05:00:00Z", null)).toBe("-");
    expect(formatDurationBetween(null, null, "—")).toBe("—");
  });

  it("falls back for a negative range", () => {
    expect(
      formatDurationBetween("2026-08-11T13:30:00Z", "2026-08-11T05:00:00Z"),
    ).toBe("-");
  });
});
