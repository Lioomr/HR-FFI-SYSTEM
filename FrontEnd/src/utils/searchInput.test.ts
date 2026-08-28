import { describe, it, expect } from "vitest";
import {
  MAX_SEARCH_LENGTH,
  sanitizeSearchTerm,
  toSearchParam,
} from "./searchInput";

// Built from char codes so this source file stays free of literal control bytes.
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("sanitizeSearchTerm", () => {
  it("trims padding and collapses internal whitespace", () => {
    expect(sanitizeSearchTerm("   sara   ahmed  ")).toBe("sara ahmed");
  });

  it("strips control characters and line separators", () => {
    expect(sanitizeSearchTerm(`sa${NUL}ra${DEL}${LINE_SEPARATOR}`)).toBe(
      "sara",
    );
  });

  it("treats tabs and newlines as word separators rather than deleting them", () => {
    expect(sanitizeSearchTerm("sara\tahmed\nnasser")).toBe("sara ahmed nasser");
  });

  it("caps the term at the maximum length", () => {
    const result = sanitizeSearchTerm("a".repeat(MAX_SEARCH_LENGTH + 50));
    expect(result).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it("returns an empty string for nullish input", () => {
    expect(sanitizeSearchTerm(null)).toBe("");
    expect(sanitizeSearchTerm(undefined)).toBe("");
    expect(sanitizeSearchTerm("   ")).toBe("");
  });

  // Blocklisting SQL punctuation would break real names while adding nothing on
  // top of the server's parameterized queries — these must pass through intact.
  it.each(["O'Brien", "D'Souza", "Jean-Luc", "a+b@ffi.test", "50% raise"])(
    "leaves the legitimate term '%s' untouched",
    (term) => {
      expect(sanitizeSearchTerm(term)).toBe(term);
    },
  );
});

describe("toSearchParam", () => {
  it("omits the parameter when nothing meaningful was typed", () => {
    expect(toSearchParam("   ")).toBeUndefined();
    expect(toSearchParam(null)).toBeUndefined();
  });

  it("returns the sanitized term when there is one", () => {
    expect(toSearchParam("  sara  ")).toBe("sara");
  });
});
