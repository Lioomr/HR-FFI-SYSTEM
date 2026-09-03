import { describe, expect, it } from "vitest";

import { translations } from "./translations";

/**
 * The contract-decision and loan-PDF surfaces ship in both languages, so an
 * English-only key would show a raw key string to Arabic users.
 */

const en = translations.en;
const ar = translations.ar;

const PREFIXES = ["contractDecisions.", "loans.pdf."];

function ownedKeys(dictionary: Record<string, string>) {
  return Object.keys(dictionary).filter((key) =>
    PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

describe("contract decision and loan PDF translations", () => {
  it("has an Arabic string for every English key", () => {
    expect(ownedKeys(en).filter((key) => !ar[key])).toEqual([]);
  });

  it("has an English string for every Arabic key", () => {
    expect(ownedKeys(ar).filter((key) => !en[key])).toEqual([]);
  });

  it("keeps the {status} token so the backend status is interpolated", () => {
    expect(en["contractDecisions.resultStatus"]).toContain("{status}");
    expect(ar["contractDecisions.resultStatus"]).toContain("{status}");
  });

  it("names each of the six salary components plus the derived total", () => {
    const fields = [
      "basic_salary",
      "transportation_allowance",
      "accommodation_allowance",
      "telephone_allowance",
      "petrol_allowance",
      "other_allowance",
      "total_salary",
    ];
    fields.forEach((field) => {
      const key = `contractDecisions.terms.${field}`;
      expect(en[key], `missing English string for ${key}`).toBeTruthy();
      expect(ar[key], `missing Arabic string for ${key}`).toBeTruthy();
    });
  });

  it("covers every status the backend can return", () => {
    const required = [
      "contractDecisions.pendingHr",
      "contractDecisions.pendingCeo",
      "contractDecisions.approved",
      "contractDecisions.autoApproved",
      "contractDecisions.autoRenewedShort",
      "contractDecisions.rejected",
      "contractDecisions.renewalFailed",
      "contractDecisions.manualResolution",
    ];
    required.forEach((key) => {
      expect(en[key], `missing English string for ${key}`).toBeTruthy();
      expect(ar[key], `missing Arabic string for ${key}`).toBeTruthy();
    });
  });

  it("tells a failed automatic renewal apart from a manual resolution", () => {
    // These two shared one label before, which hid a status the HR user cannot
    // resubmit behind the wording of one they can.
    expect(en["contractDecisions.renewalFailed"]).not.toBe(
      en["contractDecisions.manualResolution"],
    );
    expect(ar["contractDecisions.renewalFailed"]).not.toBe(
      ar["contractDecisions.manualResolution"],
    );
  });

  it("has both languages for the shared access-denied label", () => {
    expect(en["common.forbidden"]).toBeTruthy();
    expect(ar["common.forbidden"]).toBeTruthy();
  });
});
