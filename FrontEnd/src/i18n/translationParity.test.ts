import { describe, expect, it } from "vitest";

import { translations } from "./translations";

/**
 * Every screen ships in English and Arabic. A key missing from either
 * dictionary renders the raw key (or the English fallback) to that audience,
 * and a dropped `{token}` shows the literal placeholder instead of the value.
 */

const en = translations.en;
const ar = translations.ar;

function tokens(value: string) {
  return (value.match(/\{[a-zA-Z_]+\}/g) ?? []).sort();
}

describe("translation dictionary parity", () => {
  it("has a non-empty Arabic string for every English key", () => {
    expect(Object.keys(en).filter((key) => !ar[key]?.trim())).toEqual([]);
  });

  it("has a non-empty English string for every Arabic key", () => {
    expect(Object.keys(ar).filter((key) => !en[key]?.trim())).toEqual([]);
  });

  it("keeps the same interpolation tokens in both languages", () => {
    const mismatched = Object.keys(en).filter(
      (key) =>
        key in ar &&
        tokens(en[key]).join(",") !== tokens(ar[key]).join(","),
    );
    expect(mismatched).toEqual([]);
  });
});
