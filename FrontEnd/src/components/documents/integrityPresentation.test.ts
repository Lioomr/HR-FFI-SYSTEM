import { describe, expect, it } from "vitest";

import { normalizeIntegrity } from "../../services/api/documentIntegrityApi";
import { translations } from "../../i18n/translations";
import {
  canRetrySealFor,
  hasUntrustedRoot,
  integrityPresentation,
  shortHash,
} from "./integrityPresentation";

describe("integrityPresentation", () => {
  it("presents a hash-only match as hash verified, not signed", () => {
    const view = integrityPresentation("frozen_valid", "hash_only");
    expect(view.labelKey).toBe("documentIntegrity.status.hash_verified");
    expect(view.tone).toBe("success");
    for (const lang of ["en", "ar"] as const) {
      expect(translations[lang][view.labelKey]).toBeTruthy();
      expect(translations[lang][view.helpKey]).toBeTruthy();
      expect(
        translations[lang]["documentIntegrity.verifyHelp.hash_verified"],
      ).toBeTruthy();
    }
    // An altered notice stays red.
    const tampered = integrityPresentation("tampered", "hash_only");
    expect(tampered.tone).toBe("error");
    expect(tampered.labelKey).toBe("documentIntegrity.status.tampered");
    // Other modes are unchanged.
    expect(integrityPresentation("frozen_valid", "seal").labelKey).toBe(
      "documentIntegrity.status.frozen_valid",
    );
  });

  it.each([
    ["signed_valid", "success"],
    ["sealed_valid", "success"],
    ["frozen_valid", "success"],
    ["seal_pending", "warning"],
    ["seal_failed", "warning"],
    ["tampered", "error"],
    ["missing_file", "error"],
    ["not_frozen", "neutral"],
  ] as const)("maps %s to the %s tone", (status, tone) => {
    const view = integrityPresentation(status);
    expect(view.tone).toBe(tone);
    // Every status has a label and help sentence in both languages.
    for (const lang of ["en", "ar"] as const) {
      expect(translations[lang][view.labelKey]).toBeTruthy();
      expect(translations[lang][view.helpKey]).toBeTruthy();
    }
  });

  it("only offers a seal retry for failed or pending seals", () => {
    expect(canRetrySealFor("seal_failed")).toBe(true);
    expect(canRetrySealFor("seal_pending")).toBe(true);
    expect(canRetrySealFor("sealed_valid")).toBe(false);
    expect(canRetrySealFor("tampered")).toBe(false);
  });

  it("flags a valid seal that chains to the internal CA", () => {
    const sealed = (trust: string, valid: boolean) =>
      normalizeIntegrity({
        status: "sealed_valid",
        seal: { present: true, valid, trust },
      });
    expect(hasUntrustedRoot(sealed("untrusted_root", true))).toBe(true);
    expect(hasUntrustedRoot(sealed("trusted", true))).toBe(false);
    expect(hasUntrustedRoot(sealed("untrusted_root", false))).toBe(false);
  });

  it("shortens a SHA-256 for display", () => {
    const hash = "0123456789abcdef".repeat(4);
    expect(shortHash(hash)).toBe("0123456789ab…abcdef");
    expect(shortHash(null)).toBe("-");
  });
});
