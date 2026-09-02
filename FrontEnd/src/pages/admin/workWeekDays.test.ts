import { describe, expect, it } from "vitest";

import { WORK_WEEK_DAY_OPTIONS } from "./workWeekDays";
import { translations } from "../../i18n/translations";

/**
 * `work_week_days` is submitted to the attendance backend as Python
 * `date.weekday()` numbers (Mon=0 … Sun=6). The value attached to each label is
 * therefore load-bearing: a wrong number here silently shifts which days the
 * schedule treats as working days, changing Late / Absent classification.
 */
describe("WORK_WEEK_DAY_OPTIONS", () => {
  const valueByKey = Object.fromEntries(
    WORK_WEEK_DAY_OPTIONS.map((option) => [option.labelKey, option.value]),
  );

  it("maps each weekday to its Python weekday() index", () => {
    expect(valueByKey["common.weekday.monday"]).toBe(0);
    expect(valueByKey["common.weekday.tuesday"]).toBe(1);
    expect(valueByKey["common.weekday.wednesday"]).toBe(2);
    expect(valueByKey["common.weekday.thursday"]).toBe(3);
    expect(valueByKey["common.weekday.friday"]).toBe(4);
    expect(valueByKey["common.weekday.saturday"]).toBe(5);
    expect(valueByKey["common.weekday.sunday"]).toBe(6);
  });

  it("lists all seven days once, displayed Sunday → Saturday", () => {
    expect(WORK_WEEK_DAY_OPTIONS).toHaveLength(7);
    expect(WORK_WEEK_DAY_OPTIONS.map((option) => option.value)).toEqual([
      6, 0, 1, 2, 3, 4, 5,
    ]);
  });

  it("covers exactly the integers 0–6", () => {
    const sorted = WORK_WEEK_DAY_OPTIONS.map((option) => option.value).sort(
      (a, b) => a - b,
    );
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("points every label at a translation key present in both languages", () => {
    for (const option of WORK_WEEK_DAY_OPTIONS) {
      expect(
        translations.en[option.labelKey],
        `en ${option.labelKey}`,
      ).toBeTruthy();
      expect(
        translations.ar[option.labelKey],
        `ar ${option.labelKey}`,
      ).toBeTruthy();
    }
  });
});
