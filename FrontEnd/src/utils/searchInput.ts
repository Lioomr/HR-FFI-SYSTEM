/**
 * Hardening for free-text values that get forwarded to the API as query
 * parameters (search boxes, filter fields).
 *
 * Scope note: SQL injection is defended against on the server, where the ORM
 * parameterizes every query. This module is defence in depth for the transport
 * layer — it bounds what the client will send and strips bytes that have no
 * business in a search term.
 *
 * It deliberately does NOT blocklist quotes, semicolons, `--`, or SQL keywords.
 * Real names contain apostrophes ("O'Brien", "D'Souza"), so stripping them breaks
 * legitimate searches while adding no protection a parameterized query does not
 * already provide.
 */

/** Upper bound on a search term. Long enough for any real name or email. */
export const MAX_SEARCH_LENGTH = 128;

// Tab, newline and carriage return are left in place: they are whitespace, and the
// collapse step below turns them into a single space rather than joining words.
const WHITESPACE_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

/**
 * C0/C1 control characters plus the Unicode line/paragraph separators. These are
 * never typed intentionally and are a common way to smuggle payloads past naive
 * log parsers and header handling.
 *
 * Expressed as a code-point test rather than a regex so the source file contains
 * no literal control bytes and needs no `no-control-regex` suppression.
 */
function isControlCharacter(codePoint: number): boolean {
  if (WHITESPACE_CONTROLS.has(codePoint)) return false;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    if (!isControlCharacter(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/**
 * Normalizes a raw search box value before it is sent to the API.
 * Drops control characters, collapses runs of whitespace, and caps the length.
 */
export function sanitizeSearchTerm(value: string | null | undefined): string {
  if (!value) return "";
  return stripControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
}

/**
 * Same normalization, but returns `undefined` for an empty result so callers can
 * omit the parameter entirely rather than sending `search=`.
 */
export function toSearchParam(value: string | null | undefined): string | undefined {
  return sanitizeSearchTerm(value) || undefined;
}
