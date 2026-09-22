import { describe, expect, it } from "vitest";
import { formatHeaderDate, formatHijriDate } from "./headerDate";

describe("formatHeaderDate", () => {
  const date = new Date(2026, 8, 21, 23, 59);

  it("shows the weekday and full date without a time in English", () => {
    expect(formatHeaderDate(date, "en")).toBe("Monday, 21 September 2026");
  });

  it("keeps the Gregorian calendar and Latin digits in Arabic", () => {
    const label = formatHeaderDate(date, "ar");
    expect(label).toContain("الاثنين");
    expect(label).toContain("سبتمبر");
    expect(label).toContain("2026");
    expect(label).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("formats the Hijri date with the Umm al-Qura calendar", () => {
    expect(formatHijriDate(date)).toBe("10 ربيع الآخر 1448 هـ");
  });
});
