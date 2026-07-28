import { describe, expect, it } from '@jest/globals';

import { ApiError, safeApiError, safeValidationDetails } from './api-error';

describe('safeApiError status mapping', () => {
  it('separates forbidden and not-found from generic request failure', () => {
    expect(safeApiError(403, true).code).toBe('forbidden');
    expect(safeApiError(404, true).code).toBe('not_found');
    expect(safeApiError(409, true).code).toBe('request_failed');
  });

  it('keeps the existing authentication, throttle, and server mappings', () => {
    expect(safeApiError(401, true).code).toBe('session_expired');
    expect(safeApiError(401, false).code).toBe('authentication_failed');
    expect(safeApiError(429, true).code).toBe('too_many_requests');
    expect(safeApiError(500, true).code).toBe('network_unavailable');
    expect(safeApiError(422, true).code).toBe('validation_failed');
  });

  it('never carries server text on non-validation failures', () => {
    const forbidden = safeApiError(403, true, ['leaked internal detail']);
    const serverError = safeApiError(500, true, ['stack frame']);

    expect(forbidden.details).toEqual([]);
    expect(serverError.details).toEqual([]);
    expect(forbidden.message).toBe('You do not have access to this information.');
  });
});

describe('safeValidationDetails', () => {
  it('normalizes the documented error envelope for validation statuses only', () => {
    const payload = {
      status: 'error',
      message: 'Validation error',
      errors: ['start_date: Enter a valid date.', { message: 'Leave type is inactive.' }],
    };

    expect(safeValidationDetails(422, payload)).toEqual([
      'start_date: Enter a valid date.',
      'Leave type is inactive.',
    ]);
    expect(safeValidationDetails(400, payload)).toHaveLength(2);
    expect(safeValidationDetails(403, payload)).toEqual([]);
    expect(safeValidationDetails(500, payload)).toEqual([]);
  });

  it('falls back to the envelope message when no field errors are present', () => {
    expect(safeValidationDetails(422, { status: 'error', message: 'Validation error' })).toEqual([
      'Validation error',
    ]);
  });

  it('drops anything that could carry a credential, URL, or stack frame', () => {
    const payload = {
      errors: [
        'Authorization: Bearer abc.def.ghi',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u',
        'See https://internal.example.com/debug',
        'File "/app/leaves/views.py", line 12',
        'Traceback (most recent call last)',
        '<script>alert(1)</script>',
        'start_date: Enter a valid date.',
      ],
    };

    expect(safeValidationDetails(422, payload)).toEqual(['start_date: Enter a valid date.']);
  });

  it('bounds the number and length of rendered details and strips control characters', () => {
    const payload = {
      errors: [
        'a: 1',
        'b: 2',
        'c: 3',
        'd: 4',
        'e: 5',
        'f: 6',
        `g: ${'x'.repeat(400)}`,
        'h:\u0000\u001b hidden control',
      ],
    };
    const details = safeValidationDetails(422, payload);

    expect(details).toHaveLength(5);
    for (const detail of details) {
      expect(detail.length).toBeLessThanOrEqual(200);
      expect(detail).not.toMatch(/[\p{Cc}]/u);
    }
  });

  it('ignores malformed payloads instead of throwing', () => {
    expect(safeValidationDetails(422, null)).toEqual([]);
    expect(safeValidationDetails(422, ['not', 'an', 'envelope'])).toEqual([]);
    expect(safeValidationDetails(422, { errors: [1, true, null] })).toEqual([]);
  });
});

describe('ApiError details', () => {
  it('only retains details for validation failures and re-sanitizes them', () => {
    const validation = new ApiError('validation_failed', 422, [
      'reason: required',
      'Authorization: Bearer secret',
    ]);
    const forbidden = new ApiError('forbidden', 403, ['reason: required']);

    expect(validation.details).toEqual(['reason: required']);
    expect(forbidden.details).toEqual([]);
    expect(Object.isFrozen(validation.details)).toBe(true);
  });
});
