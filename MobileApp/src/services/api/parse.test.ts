import { describe, expect, it } from '@jest/globals';

import { ApiError } from './api-error';
import {
  booleanOrNull,
  finiteNumberOrNull,
  identifierOrNull,
  integerOrNull,
  parseArray,
  parsePaginated,
  requiredIdentifier,
  stringOrNull,
} from './parse';

describe('scalar parsing', () => {
  it('accepts only meaningful strings and finite numbers', () => {
    expect(stringOrNull('  ')).toBeNull();
    expect(stringOrNull('value')).toBe('value');
    expect(stringOrNull(12)).toBeNull();

    expect(finiteNumberOrNull('7.5')).toBe(7.5);
    expect(finiteNumberOrNull(Number.NaN)).toBeNull();
    expect(finiteNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteNumberOrNull('abc')).toBeNull();

    expect(integerOrNull('12.9')).toBe(12);
    expect(booleanOrNull(false)).toBe(false);
    expect(booleanOrNull('true')).toBeNull();
  });

  it('treats identifiers as opaque numbers or strings', () => {
    expect(identifierOrNull(3)).toBe(3);
    expect(identifierOrNull('abc')).toBe('abc');
    expect(identifierOrNull(null)).toBeNull();
    expect(() => requiredIdentifier(undefined)).toThrow(ApiError);
  });
});

describe('parsePaginated', () => {
  it('reads the verified {items,page,page_size,count,total_pages} contract', () => {
    const page = parsePaginated(
      { items: [{ id: 1 }, { id: 2 }], page: 2, page_size: 25, count: 42, total_pages: 2 },
      (item) => (item as { id: number }).id,
    );

    expect(page).toEqual({ items: [1, 2], page: 2, pageSize: 25, count: 42, totalPages: 2 });
  });

  it('rejects the DRF {count,next,previous,results} shape instead of coercing it', () => {
    expect(() =>
      parsePaginated({ count: 2, next: null, previous: null, results: [] }, (item) => item),
    ).toThrow(ApiError);
    expect(() => parsePaginated(null, (item) => item)).toThrow(ApiError);
    expect(() => parsePaginated({ items: 'nope' }, (item) => item)).toThrow(ApiError);
  });

  it('falls back to derived counters when optional page metadata is absent', () => {
    const page = parsePaginated({ items: [{ id: 1 }] }, (item) => (item as { id: number }).id);

    expect(page).toEqual({ items: [1], page: 1, pageSize: 1, count: 1, totalPages: 1 });
  });
});

describe('parseArray', () => {
  it('accepts bare arrays and rejects anything else', () => {
    expect(parseArray([1, 2], (item) => Number(item) * 2)).toEqual([2, 4]);
    expect(() => parseArray({ items: [] }, (item) => item)).toThrow(ApiError);
  });
});
