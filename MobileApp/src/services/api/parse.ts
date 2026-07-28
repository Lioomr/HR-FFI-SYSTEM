import { ApiError } from './api-error';

export type UnknownRecord = Record<string, unknown>;

export interface PaginatedEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  count: number;
  totalPages: number;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function identifierOrNull(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function requiredIdentifier(value: unknown): number | string {
  const identifier = identifierOrNull(value);
  if (identifier === null) throw new ApiError('invalid_response');
  return identifier;
}

export function integerOrNull(value: unknown): number | null {
  const parsed = finiteNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * The verified backend list contract is `{items, page, page_size, count, total_pages}`.
 * Anything else is rejected rather than coerced, so contract drift surfaces immediately.
 */
export function parsePaginated<T>(
  value: unknown,
  parseItem: (item: unknown) => T,
): PaginatedEnvelope<T> {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new ApiError('invalid_response');
  return {
    items: value.items.map(parseItem),
    page: integerOrNull(value.page) ?? 1,
    pageSize: integerOrNull(value.page_size) ?? value.items.length,
    count: integerOrNull(value.count) ?? value.items.length,
    totalPages: integerOrNull(value.total_pages) ?? 1,
  };
}

/** Endpoints that return a bare array in `data` (leave balances, leave types, documents). */
export function parseArray<T>(value: unknown, parseItem: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new ApiError('invalid_response');
  return value.map(parseItem);
}
