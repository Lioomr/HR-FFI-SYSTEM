import { describe, expect, it } from "vitest";

import {
  isStaleRequest,
  requestAgeInDays,
  requestAgeLabel,
} from "./requestAge";
import { translations } from "../i18n/translations";

const NOW = new Date("2026-08-12T12:00:00Z").getTime();
const DAY = 86_400_000;

const t = (
  key: string,
  params?: Record<string, any> | string,
  fallback?: string,
) => {
  const actualFallback = typeof params === "string" ? params : fallback;
  const actualParams = typeof params === "object" ? params : undefined;
  let value = translations.en?.[key] ?? actualFallback ?? key;
  if (actualParams) {
    Object.entries(actualParams).forEach(([k, v]) => {
      value = value.replace(new RegExp(`{${k}}`, "g"), String(v));
    });
  }
  return value;
};

describe("requestAgeInDays", () => {
  it("counts whole days since the request was submitted", () => {
    expect(requestAgeInDays(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe(
      3,
    );
  });

  it("returns null for a missing or unparseable timestamp", () => {
    expect(requestAgeInDays(null, NOW)).toBeNull();
    expect(requestAgeInDays("not-a-date", NOW)).toBeNull();
  });

  it("floors a future timestamp at zero rather than going negative", () => {
    expect(requestAgeInDays(new Date(NOW + 2 * DAY).toISOString(), NOW)).toBe(
      0,
    );
  });
});

describe("requestAgeLabel", () => {
  it("uses the singular form for exactly one day", () => {
    expect(requestAgeLabel(t, new Date(NOW - DAY).toISOString(), NOW)).toBe(
      "1 day waiting",
    );
  });

  it("uses the plural form beyond one day", () => {
    expect(requestAgeLabel(t, new Date(NOW - 5 * DAY).toISOString(), NOW)).toBe(
      "5 days waiting",
    );
  });

  it("says today for a request submitted within the last day", () => {
    expect(
      requestAgeLabel(t, new Date(NOW - 3600_000).toISOString(), NOW),
    ).toBe("Today");
  });
});

describe("isStaleRequest", () => {
  it("flags a request only once it passes the stale threshold", () => {
    expect(isStaleRequest(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe(
      false,
    );
    expect(isStaleRequest(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe(
      true,
    );
  });

  it("never flags a request with no timestamp", () => {
    expect(isStaleRequest(null, NOW)).toBe(false);
  });
});
