import { describe, expect, it } from '@jest/globals';

import { addDays, fromIsoDate, isIsoCalendarDate, toIsoDate, todayIsoDate } from './leave-dates';

describe('leave date serialization', () => {
  it('serializes a picked date as the local calendar day the API expects', () => {
    expect(toIsoDate(new Date(2026, 7, 1, 13, 45))).toBe('2026-08-01');
    expect(toIsoDate(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('never shifts the day across the UTC boundary in either direction', () => {
    // Late evening east of Greenwich and early morning west of it both used to roll
    // over to the neighbouring day when serialized through toISOString().
    expect(toIsoDate(new Date(2026, 7, 1, 23, 30))).toBe('2026-08-01');
    expect(toIsoDate(new Date(2026, 7, 1, 0, 30))).toBe('2026-08-01');
  });

  it('pads years, months, and days to the fixed contract width', () => {
    expect(toIsoDate(new Date(2026, 2, 9))).toBe('2026-03-09');
    expect(toIsoDate(new Date(2026, 2, 9))).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('round-trips a date through the API format without drift', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-08-15', '2026-12-31']) {
      const parsed = fromIsoDate(iso);
      expect(parsed).not.toBeNull();
      expect(toIsoDate(parsed as Date)).toBe(iso);
    }
  });

  it('parses to local noon so a daylight-saving shift cannot change the day', () => {
    const parsed = fromIsoDate('2026-03-29') as Date;

    expect(parsed.getHours()).toBe(12);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(29);
  });

  it('rejects anything that is not a real calendar day', () => {
    for (const invalid of [
      '',
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '2026-01-32',
      '2026-8-1',
      '01/08/2026',
      '2026-08-01T00:00:00Z',
      'today',
    ]) {
      expect([invalid, isIsoCalendarDate(invalid)]).toEqual([invalid, false]);
      expect(fromIsoDate(invalid)).toBeNull();
    }
  });

  it('accepts leap days only in leap years', () => {
    expect(isIsoCalendarDate('2028-02-29')).toBe(true);
    expect(isIsoCalendarDate('2026-02-29')).toBe(false);
  });

  it('derives today and relative days in local calendar terms', () => {
    expect(todayIsoDate(new Date(2026, 6, 28, 1, 0))).toBe('2026-07-28');
    expect(toIsoDate(addDays(new Date(2026, 6, 28), 4))).toBe('2026-08-01');
    expect(toIsoDate(addDays(new Date(2026, 6, 28), -28))).toBe('2026-06-30');
  });
});
