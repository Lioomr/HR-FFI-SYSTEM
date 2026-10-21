import { describe, expect, it } from "vitest";

import { translations } from "./translations";
import { humanizeCode, labelFromCode } from "../utils/humanizeCode";

/**
 * End users should never read developer vocabulary. Admin-only integration
 * screens (BioTime, WhatsApp/Evolution) legitimately name an API, so they are
 * allowed by key prefix.
 */
const DEVELOPER_TERMS = /\b(API|backend|endpoint|payload|JSON|serializer)\b/i;

const ALLOWED_PREFIXES = ["bioTime.", "admin.whatsapp."];

describe("user-facing wording", () => {
  it.each(["en", "ar"] as const)("%s has no developer vocabulary", (lang) => {
    const offenders = Object.entries(translations[lang])
      .filter(([key]) => !ALLOWED_PREFIXES.some((p) => key.startsWith(p)))
      .filter(([, value]) => DEVELOPER_TERMS.test(String(value)))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

describe("humanizeCode", () => {
  it("turns backend codes into readable text", () => {
    expect(humanizeCode("hr_completion")).toBe("Hr completion");
    expect(humanizeCode("IN_REVIEW")).toBe("In review");
    expect(humanizeCode(undefined)).toBe("");
  });

  it("prefers a translation and falls back to readable text", () => {
    const t = (key: string) => (key === "x.known" ? "Known" : key);
    expect(labelFromCode(t, "x", "known")).toBe("Known");
    expect(labelFromCode(t, "x", "some_code")).toBe("Some code");
  });
});
