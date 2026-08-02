/**
 * Date serialization for leave requests.
 *
 * The verified backend contract is a plain `YYYY-MM-DD` calendar date, so a picked
 * `Date` is read in the device's local calendar and never converted through UTC — a
 * UTC round trip would shift the day for anyone east or west of Greenwich and submit
 * the wrong date. No new field or format is introduced here.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Local calendar day of a `Date`, formatted exactly as the API expects. */
export function toIsoDate(value: Date): string {
  const year = `${value.getFullYear()}`.padStart(4, '0');
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses an API date back into a local-noon `Date`, safe against DST edges. */
export function fromIsoDate(value: string): Date | null {
  if (!isIsoCalendarDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** True only for a real calendar day in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
}

export function todayIsoDate(now: Date = new Date()): string {
  return toIsoDate(now);
}

/** Adds whole days in local calendar terms, used for the picker's default range. */
export function addDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}
