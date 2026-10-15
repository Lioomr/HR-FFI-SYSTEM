import type { ExactShare, Money } from "../services/api/payrollTypes";

/**
 * Display-only helpers for payroll decimal strings.
 *
 * Every function here works on the string digits. Nothing converts money to a
 * JavaScript number, so there is no float drift and no hidden payroll
 * arithmetic: the backend's value is shown exactly as sent.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

function groupThousands(integerDigits: string): string {
  const trimmed = integerDigits.replace(/^0+(?=\d)/, "");
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a money string for display.
 * - "733.00" -> "733" (posted payroll lines are whole riyals)
 * - "1234567.50" -> "1,234,567.50" (legacy halalas are kept, never rounded)
 * - null/undefined/invalid -> null, so callers render "Unknown" (never 0).
 */
export function formatMoney(value: Money | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const match = DECIMAL.exec(String(value).trim());
  if (!match) return null;
  const [, sign, integerDigits, fraction = ""] = match;
  const grouped = groupThousands(integerDigits);
  const keptFraction = /^0*$/.test(fraction) ? "" : fraction.padEnd(2, "0");
  const isZero = /^0+$/.test(integerDigits) && keptFraction === "";
  return `${sign && !isZero ? "-" : ""}${grouped}${keptFraction ? `.${keptFraction}` : ""}`;
}

/**
 * Display text for an ExactShare: its `decimal` approximation cut (not
 * rounded) to `fractionDigits` places. Callers must label it as approximate.
 */
export function formatExactShare(
  share: ExactShare | null | undefined,
  fractionDigits = 2,
): string | null {
  if (!share) return null;
  const match = DECIMAL.exec(share.decimal.trim());
  if (!match) return null;
  const [, sign, integerDigits, fraction = ""] = match;
  const cut = fraction.slice(0, fractionDigits).replace(/0+$/, "");
  const grouped = groupThousands(integerDigits);
  const isZero = /^0+$/.test(integerDigits) && cut === "";
  return `${sign && !isZero ? "-" : ""}${grouped}${cut ? `.${cut}` : ""}`;
}

/** True when the ExactShare's decimal approximation carries more digits than shown. */
export function isExactShareTruncated(
  share: ExactShare,
  fractionDigits = 2,
): boolean {
  const fraction = share.decimal.split(".")[1] ?? "";
  return /[1-9]/.test(fraction.slice(fractionDigits));
}

/**
 * Validates a nonnegative decimal input (money or quantity) as typed by a user.
 * Accepts "12000", "12000.5", "12000.50"; rejects signs, exponents, formulas.
 */
export function isNonNegativeDecimal(value: string, maxFraction = 2): boolean {
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${maxFraction}})?$`);
  return pattern.test(value.trim());
}

/** "12000" -> "12000.00", "12.5" -> "12.50". Input must pass isNonNegativeDecimal. */
export function toMoneyString(value: string): Money {
  const [integerDigits, fraction = ""] = value.trim().split(".");
  const normalisedInteger = integerDigits.replace(/^0+(?=\d)/, "");
  return `${normalisedInteger}.${fraction.padEnd(2, "0")}`;
}

/** Same as toMoneyString for day/hour quantities (two fractional digits). */
export const toQuantityString = toMoneyString;

/** "12000.00" -> "12000" for editing in an input; keeps nonzero halalas. */
export function moneyToInput(value: Money | null | undefined): string {
  if (value === null || value === undefined) return "";
  const [integerDigits, fraction = ""] = value.split(".");
  return /^0*$/.test(fraction) ? integerDigits : `${integerDigits}.${fraction}`;
}

/** Moves the decimal point of a nonnegative decimal string by `places` (+ right, - left). */
function shiftDecimal(value: string, places: number): string {
  const [integerDigits, fraction = ""] = value.split(".");
  const digits = integerDigits + fraction;
  let pointIndex = integerDigits.length + places;
  let allDigits = digits;
  if (pointIndex < 0) {
    allDigits = "0".repeat(-pointIndex) + allDigits;
    pointIndex = 0;
  }
  if (pointIndex > allDigits.length) {
    allDigits = allDigits + "0".repeat(pointIndex - allDigits.length);
  }
  const intPart =
    allDigits.slice(0, pointIndex).replace(/^0+(?=\d)/, "") || "0";
  const fracPart = allDigits.slice(pointIndex);
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * GOSI rate string -> percentage text for the UI: "0.020000" -> "2",
 * "0.097500" -> "9.75". String shift only, no floats.
 */
export function rateToPercent(rate: string | null | undefined): string {
  if (!rate || !DECIMAL.test(rate.trim())) return "";
  const shifted = shiftDecimal(rate.trim(), 2);
  const [integerDigits, fraction = ""] = shifted.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction
    ? `${integerDigits}.${trimmedFraction}`
    : integerDigits;
}

/** A percentage the API can store: 0..100 with at most four fractional digits. */
export function isValidPercent(value: string): boolean {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return false;
  const [integerDigits, fraction = ""] = text.split(".");
  const integer = integerDigits.replace(/^0+(?=\d)/, "");
  if (integer.length > 3) return false;
  if (integer.length === 3) return integer === "100" && /^0*$/.test(fraction);
  return true;
}

/**
 * Percentage text -> contract rate string with six fractional digits:
 * "2" -> "0.020000", "9.75" -> "0.097500". Caller validates with isValidPercent.
 */
export function percentToRate(percent: string): string {
  const shifted = shiftDecimal(percent.trim(), -2);
  const [integerDigits, fraction = ""] = shifted.split(".");
  return `${integerDigits}.${fraction.padEnd(6, "0").slice(0, 6)}`;
}
