import { describe, expect, it } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  cancelLeaveRequest,
  isIsoDate,
  LEAVE_BALANCE_PATH,
  LEAVE_REQUESTS_PATH,
  LEAVE_SUBMIT_PATH,
  LEAVE_TYPES_PATH,
  loadLeaveOverview,
  parseLeaveRequest,
  submitLeaveRequest,
  validateLeaveDraft,
} from './leave-api';

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

function fakeClient(handler: (call: Call) => unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async request(path: string, options?: { method?: string; body?: unknown }) {
      const call = { path, method: options?.method, body: options?.body };
      calls.push(call);
      const result = handler(call);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const balancePayload = [
  {
    leave_type_id: 1,
    leave_type: 'Annual',
    total_days: '21.00',
    used_days: '5.00',
    remaining_days: '16.00',
  },
];

const requestsPayload = {
  items: [
    {
      id: 31,
      leave_type: { id: 1, name: 'Annual', code: 'ANNUAL', is_active: true },
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      status: 'pending_manager',
      days: 5,
      reason: 'Family trip',
      created_at: '2026-07-20T09:00:00Z',
      decision_reason: null,
      decided_at: null,
    },
  ],
  page: 1,
  page_size: 25,
  count: 1,
  total_pages: 1,
};

const leaveTypesPayload = [
  { id: 1, name: 'Annual', code: 'ANNUAL', is_active: true },
  { id: 9, name: 'Retired type', code: 'OLD', is_active: false },
];

describe('leave contract', () => {
  it('uses only the verified employee self-service and submission paths', () => {
    expect(LEAVE_BALANCE_PATH).toBe('/api/leaves/employee/leave-balance/');
    expect(LEAVE_REQUESTS_PATH).toBe('/api/leaves/employee/leave-requests/');
    expect(LEAVE_TYPES_PATH).toBe('/api/leaves/leave-types/');
    expect(LEAVE_SUBMIT_PATH).toBe('/api/leaves/leave-requests/');
  });

  it('loads balance, own requests, and leave types without an employee selector', async () => {
    const { calls, client } = fakeClient((call) => {
      if (call.path.startsWith(LEAVE_BALANCE_PATH)) return balancePayload;
      if (call.path.startsWith(LEAVE_REQUESTS_PATH)) return requestsPayload;
      return leaveTypesPayload;
    });

    const overview = await loadLeaveOverview(2026, client);

    expect(calls.map((call) => call.path)).toEqual([
      '/api/leaves/employee/leave-balance/?year=2026',
      '/api/leaves/employee/leave-requests/?page=1&page_size=25',
      '/api/leaves/leave-types/',
    ]);
    for (const call of calls) expect(call.path).not.toMatch(/employee_id|employee=/u);
    expect(overview.balances).toEqual({
      status: 'ready',
      data: [
        { leaveTypeId: 1, leaveType: 'Annual', totalDays: 21, usedDays: 5, remainingDays: 16 },
      ],
    });
    expect(overview.requests.status).toBe('ready');
    expect(overview.year).toBe(2026);
  });

  it('hides inactive leave types from the request form', async () => {
    const { client } = fakeClient((call) =>
      call.path === LEAVE_TYPES_PATH ? leaveTypesPayload : { items: [] },
    );

    const overview = await loadLeaveOverview(2026, client);

    expect(overview.leaveTypes).toEqual({
      status: 'ready',
      data: [{ id: 1, name: 'Annual', code: 'ANNUAL', isActive: true }],
    });
  });

  it('keeps one failing section from discarding the others', async () => {
    const { client } = fakeClient((call) => {
      if (call.path.startsWith(LEAVE_BALANCE_PATH)) return new ApiError('forbidden', 403);
      if (call.path.startsWith(LEAVE_REQUESTS_PATH)) return requestsPayload;
      return new ApiError('network_unavailable');
    });

    const overview = await loadLeaveOverview(2026, client);

    expect(overview.balances).toEqual({ status: 'error', kind: 'forbidden' });
    expect(overview.leaveTypes).toEqual({ status: 'error', kind: 'offline' });
    expect(overview.requests.status).toBe('ready');
  });

  it('maps the nested leave type and decision fields of a request', () => {
    const request = parseLeaveRequest(requestsPayload.items[0]);

    expect(request).toEqual({
      id: 31,
      leaveTypeName: 'Annual',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      status: 'pending_manager',
      days: 5,
      reason: 'Family trip',
      createdAt: '2026-07-20T09:00:00Z',
      decisionReason: null,
      decidedAt: null,
    });
  });
});

describe('leave draft validation', () => {
  it('accepts only real ISO calendar dates', () => {
    expect(isIsoDate('2026-08-01')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-8-1')).toBe(false);
    expect(isIsoDate('01/08/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('reports missing type, malformed dates, and reversed ranges', () => {
    expect(
      validateLeaveDraft({ leaveTypeId: null, startDate: '', endDate: '', reason: '' }),
    ).toEqual({
      leaveTypeId: 'leave.leaveTypeRequired',
      startDate: 'leave.invalidDate',
      endDate: 'leave.invalidDate',
    });

    expect(
      validateLeaveDraft({
        leaveTypeId: 1,
        startDate: '2026-08-05',
        endDate: '2026-08-01',
        reason: '',
      }),
    ).toEqual({ endDate: 'leave.endBeforeStart' });

    expect(
      validateLeaveDraft({
        leaveTypeId: 1,
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        reason: '',
      }),
    ).toEqual({});
  });
});

describe('leave submission', () => {
  it('sends the verified leave_type field and no ownership override', async () => {
    const { calls, client } = fakeClient(() => ({ id: 40 }));

    const outcome = await submitLeaveRequest(
      { leaveTypeId: 1, startDate: '2026-08-01', endDate: '2026-08-05', reason: '  Trip  ' },
      client,
    );

    expect(outcome).toEqual({ status: 'success' });
    expect(calls).toEqual([
      {
        path: '/api/leaves/leave-requests/',
        method: 'POST',
        body: {
          leave_type: 1,
          start_date: '2026-08-01',
          end_date: '2026-08-05',
          reason: 'Trip',
        },
      },
    ]);
    expect(Object.keys(calls[0].body as object)).not.toContain('employee_id');
    expect(Object.keys(calls[0].body as object)).not.toContain('leave_type_id');
  });

  it('surfaces sanitized server validation text to the employee', async () => {
    const { client } = fakeClient(
      () =>
        new ApiError('validation_failed', 422, [
          'You already have a pending or approved leave request for this period.',
        ]),
    );

    const outcome = await submitLeaveRequest(
      { leaveTypeId: 1, startDate: '2026-08-01', endDate: '2026-08-05', reason: '' },
      client,
    );

    expect(outcome).toEqual({
      status: 'failed',
      messageKey: 'state.validationFailed',
      details: ['You already have a pending or approved leave request for this period.'],
    });
  });

  it('reports authorization and offline failures without server detail', async () => {
    const forbidden = fakeClient(() => new ApiError('forbidden', 403));
    const offline = fakeClient(() => new ApiError('network_unavailable'));
    const draft = { leaveTypeId: 1, startDate: '2026-08-01', endDate: '2026-08-05', reason: '' };

    expect(await submitLeaveRequest(draft, forbidden.client)).toEqual({
      status: 'failed',
      messageKey: 'state.unauthorizedBody',
      details: [],
    });
    expect(await submitLeaveRequest(draft, offline.client)).toEqual({
      status: 'failed',
      messageKey: 'state.offlineBody',
      details: [],
    });
  });

  it('rethrows session expiry so the route boundary can sign the employee out', async () => {
    const { client } = fakeClient(() => new ApiError('session_expired', 401));

    await expect(
      submitLeaveRequest(
        { leaveTypeId: 1, startDate: '2026-08-01', endDate: '2026-08-05', reason: '' },
        client,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('leave cancellation', () => {
  it('posts to the owner-only cancel action for the selected request', async () => {
    const { calls, client } = fakeClient(() => ({ id: 31, status: 'cancelled' }));

    expect(await cancelLeaveRequest(31, client)).toEqual({ status: 'success' });
    expect(calls).toEqual([
      { path: '/api/leaves/leave-requests/31/cancel/', method: 'POST', body: undefined },
    ]);
  });

  it('encodes an unexpected identifier instead of building an arbitrary path', async () => {
    const { calls, client } = fakeClient(() => ({}));

    await cancelLeaveRequest('31/../../auth/logout', client);

    expect(calls[0].path).toBe('/api/leaves/leave-requests/31%2F..%2F..%2Fauth%2Flogout/cancel/');
  });

  it('explains that only pending requests can be cancelled', async () => {
    const { client } = fakeClient(
      () => new ApiError('validation_failed', 422, ['Only pending requests can be cancelled.']),
    );

    expect(await cancelLeaveRequest(31, client)).toEqual({
      status: 'failed',
      messageKey: 'leave.cancelOnlyPending',
      details: ['Only pending requests can be cancelled.'],
    });
  });

  it('maps a non-owned request to the generic access state', async () => {
    const { client } = fakeClient(() => new ApiError('not_found', 404));

    expect(await cancelLeaveRequest(999, client)).toEqual({
      status: 'failed',
      messageKey: 'state.unauthorizedBody',
      details: [],
    });
  });
});
