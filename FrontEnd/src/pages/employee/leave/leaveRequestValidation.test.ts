import { beforeEach, describe, expect, it } from "vitest";

import {
  annualLeaveDaysIssueMessage,
  isAnnualLeaveCode,
  readLeaveBalanceFigures,
  validateAnnualLeaveDays,
} from "./leaveRequestValidation";
import { useI18nStore } from "../../../i18n/i18nStore";
import { translations } from "../../../i18n/translations";

/** Mirrors `useI18n`'s `t` so message wording can be asserted without React. */
const t = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => {
  const language = useI18nStore.getState().language;
  const actualFallback = typeof params === "string" ? params : fallback;
  const actualParams = typeof params === "object" ? params : undefined;
  let translated = translations[language]?.[key] ?? actualFallback ?? key;
  if (actualParams) {
    Object.entries(actualParams).forEach(([k, v]) => {
      translated = translated.replace(new RegExp(`{${k}}`, "g"), String(v));
    });
  }
  return translated;
};

/** The exact shape the backend returns: decimals as strings. */
const annualBalance = {
  leave_code: "ANNUAL",
  total_days: "12.25",
  used_days: "2.00",
  remaining_days: "10.25",
  pending_days: "3.00",
  requestable_days: "7.00",
  fractional_days: "0.25",
};

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
});

describe("annual leave code detection", () => {
  it.each(["ANNUAL", "annual", "ANNUAL_LEAVE"])("recognises %s", (code) => {
    expect(isAnnualLeaveCode(code)).toBe(true);
  });

  it.each(["SICK", "UNPAID", undefined, null, ""])(
    "does not recognise %s",
    (code) => {
      expect(isAnnualLeaveCode(code)).toBe(false);
    },
  );
});

describe("reading the backend balance figures", () => {
  it("parses the decimal strings without recalculating anything", () => {
    expect(readLeaveBalanceFigures(annualBalance)).toEqual({
      total: 12.25,
      used: 2,
      remaining: 10.25,
      pending: 3,
      requestable: 7,
      fractional: 0.25,
      hasRequestableDays: true,
    });
  });

  it("flags a payload that predates the accrual fields", () => {
    expect(
      readLeaveBalanceFigures({ remaining_days: 9 }).hasRequestableDays,
    ).toBe(false);
  });
});

describe("annual leave request limit", () => {
  it("allows exactly requestable_days", () => {
    expect(validateAnnualLeaveDays(7, annualBalance)).toBeNull();
  });

  it("rejects one day more than requestable_days", () => {
    expect(validateAnnualLeaveDays(8, annualBalance)).toEqual({
      code: "exceeds_requestable",
      requestable: 7,
      pending: 3,
    });
  });

  it("does not use total_days or remaining_days as the limit", () => {
    // remaining_days is 10.25 and total_days 12.25 — both above requestable_days.
    expect(validateAnnualLeaveDays(10, annualBalance)).not.toBeNull();
    expect(validateAnnualLeaveDays(12, annualBalance)).not.toBeNull();
  });

  it("rejects decimal day counts before the limit is even considered", () => {
    expect(validateAnnualLeaveDays(2.5, annualBalance)).toEqual({
      code: "decimal_days",
    });
  });

  it("stays silent when the backend omitted requestable_days", () => {
    expect(validateAnnualLeaveDays(30, { remaining_days: 9 })).toBeNull();
  });

  it("stays silent for an empty date range", () => {
    expect(validateAnnualLeaveDays(0, annualBalance)).toBeNull();
  });
});

describe("issue messages", () => {
  it("names the requestable and reserved days in English", () => {
    const issue = validateAnnualLeaveDays(8, annualBalance);
    expect(issue).not.toBeNull();
    expect(annualLeaveDaysIssueMessage(issue!, t)).toBe(
      "Annual Leave exceeds your requestable balance (7 day(s) requestable, 3 day(s) reserved by pending requests).",
    );
  });

  it("explains the whole-day rule in English", () => {
    expect(annualLeaveDaysIssueMessage({ code: "decimal_days" }, t)).toBe(
      "Annual Leave can be requested in whole days only.",
    );
  });

  it("is translated in Arabic", () => {
    useI18nStore.getState().setLanguage("ar");
    expect(annualLeaveDaysIssueMessage({ code: "decimal_days" }, t)).toBe(
      "يمكن طلب الإجازة السنوية بأيام كاملة فقط.",
    );
  });
});
