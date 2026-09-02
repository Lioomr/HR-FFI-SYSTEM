/**
 * Working-day options for the company-wide attendance work schedule.
 *
 * `value` is Python's `date.weekday()` — Monday = 0 … Sunday = 6 — which is the
 * wire format the attendance backend stores in `work_week_days` and reasons
 * about when classifying Late / Absent. The list is ordered Sunday → Saturday so
 * the checkboxes read the way the business week does in the region; the numeric
 * values, not the order, are what gets submitted.
 */
export interface WorkWeekDayOption {
  /** Python `date.weekday()`: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6. */
  value: number;
  /** i18n key for the weekday label. */
  labelKey: string;
}

export const WORK_WEEK_DAY_OPTIONS: readonly WorkWeekDayOption[] = [
  { value: 6, labelKey: "common.weekday.sunday" },
  { value: 0, labelKey: "common.weekday.monday" },
  { value: 1, labelKey: "common.weekday.tuesday" },
  { value: 2, labelKey: "common.weekday.wednesday" },
  { value: 3, labelKey: "common.weekday.thursday" },
  { value: 4, labelKey: "common.weekday.friday" },
  { value: 5, labelKey: "common.weekday.saturday" },
];
