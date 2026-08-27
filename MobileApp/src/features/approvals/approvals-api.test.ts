import { describe, expect, it } from '@jest/globals';

import type { Role } from '@/auth/role';
import { ApiError, type ApiClient } from '@/services/api';

import {
  actOnLeaveApproval,
  approveCeoLeave,
  approveHrLeave,
  canActOnLeaveApproval,
  CEO_LEAVE_REQUESTS_PATH,
  hasLeaveApprovalAccess,
  HR_LEAVE_REQUESTS_PATH,
  loadCeoLeaveApprovals,
  loadHrLeaveApprovals,
  loadLeaveApprovals,
  parseApprovalLeaveRequest,
  rejectCeoLeave,
  rejectHrLeave,
} from './approvals-api';

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

function fakeClient(handler: (call: Call) => unknown = () => emptyPage): {
  client: ApiClient;
  calls: Call[];
} {
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

/** Captured verbatim from the running backend (`GET /api/leaves/leave-requests/`). */
const listPayload = {
  items: [
    {
      id: 1,
      employee: { id: 1, email: 'employee.test@fficontracting.com', full_name: 'Test Employee' },
      leave_type: { id: 7, name: 'Unpaid Leave', code: 'UNPAID' },
      start_date: '2026-11-02',
      end_date: '2026-11-04',
      status: 'pending_hr',
      days: 3,
      reason: 'Phase 2 approvals verification request',
      created_at: '2026-08-27T21:28:14.495809Z',
      decision_reason: '',
      decided_at: null,
    },
  ],
  page: 1,
  page_size: 25,
  count: 1,
  total_pages: 1,
};

const emptyPage = { items: [], page: 1, page_size: 25, count: 0, total_pages: 1 };

describe('parseApprovalLeaveRequest', () => {
  it('lifts the requester out of the nested employee summary', () => {
    const parsed = parseApprovalLeaveRequest(listPayload.items[0]);

    expect(parsed).toMatchObject({
      id: 1,
      employeeId: 1,
      employeeName: 'Test Employee',
      employeeEmail: 'employee.test@fficontracting.com',
      leaveTypeName: 'Unpaid Leave',
      status: 'pending_hr',
      days: 3,
    });
  });

  it('tolerates a profile-only row where the serializer sends a null employee id', () => {
    const parsed = parseApprovalLeaveRequest({
      id: 9,
      employee: { id: null, email: '', full_name: 'Profile Only' },
      leave_type: { code: 'ANNUAL' },
      status: 'pending_ceo',
    });

    expect(parsed.employeeId).toBeNull();
    expect(parsed.employeeName).toBe('Profile Only');
    // Falls back to the code when the type carries no display name.
    expect(parsed.leaveTypeName).toBe('ANNUAL');
  });

  it('keeps a missing employee object from throwing', () => {
    const parsed = parseApprovalLeaveRequest({ id: 5, status: 'approved' });

    expect(parsed.employeeName).toBeNull();
    expect(parsed.employeeEmail).toBeNull();
  });
});

describe('canActOnLeaveApproval', () => {
  /**
   * Mirrors the verified backend guards: HR approve accepts SUBMITTED/PENDING_HR,
   * HR reject additionally accepts PENDING_MANAGER, CEO acts only on PENDING_CEO.
   */
  const truthTable: [Role, string, 'approve' | 'reject', boolean][] = [
    ['HRManager', 'submitted', 'approve', true],
    ['HRManager', 'pending_hr', 'approve', true],
    ['HRManager', 'pending_manager', 'approve', false],
    ['HRManager', 'pending_manager', 'reject', true],
    ['HRManager', 'submitted', 'reject', true],
    ['HRManager', 'pending_ceo', 'approve', false],
    ['HRManager', 'pending_ceo', 'reject', false],
    ['HRManager', 'approved', 'approve', false],
    ['HRManager', 'rejected', 'reject', false],
    ['SystemAdmin', 'pending_hr', 'approve', true],
    ['CEO', 'pending_ceo', 'approve', true],
    ['CEO', 'pending_ceo', 'reject', true],
    ['CEO', 'pending_hr', 'approve', false],
    ['CEO', 'submitted', 'reject', false],
    ['Employee', 'pending_hr', 'approve', false],
    ['Manager', 'pending_manager', 'reject', false],
    ['CFO', 'pending_hr', 'approve', false],
  ];

  it.each(truthTable)('%s / %s / %s -> %s', (approverRole, status, action, expected) => {
    expect(canActOnLeaveApproval(approverRole, status, action)).toBe(expected);
  });

  it('never offers an action for an unknown status', () => {
    expect(canActOnLeaveApproval('HRManager', null, 'approve')).toBe(false);
    expect(canActOnLeaveApproval('CEO', 'pending_delegate', 'reject')).toBe(false);
  });
});

describe('hasLeaveApprovalAccess', () => {
  it('admits only the roles with a leave-approval endpoint', () => {
    expect(hasLeaveApprovalAccess('HRManager')).toBe(true);
    expect(hasLeaveApprovalAccess('SystemAdmin')).toBe(true);
    expect(hasLeaveApprovalAccess('CEO')).toBe(true);
    // The CFO has an approvals tab but no leave stage of its own.
    expect(hasLeaveApprovalAccess('CFO')).toBe(false);
    expect(hasLeaveApprovalAccess('Employee')).toBe(false);
  });
});

describe('loading approvals', () => {
  it('reads the company-wide collection for HR', async () => {
    const { client, calls } = fakeClient(() => listPayload);
    const items = await loadHrLeaveApprovals(client);

    expect(calls[0].path).toBe(`${HR_LEAVE_REQUESTS_PATH}?page=1&page_size=25`);
    expect(items).toHaveLength(1);
    expect(items[0].employeeName).toBe('Test Employee');
  });

  it('reads the pending-only CEO collection for the CEO', async () => {
    const { client, calls } = fakeClient(() => emptyPage);
    await loadCeoLeaveApprovals(client);

    expect(calls[0].path).toBe(`${CEO_LEAVE_REQUESTS_PATH}?page=1&page_size=25`);
  });

  it('dispatches the list endpoint from the approver identity alone', async () => {
    for (const [approverRole, expected] of [
      ['HRManager', HR_LEAVE_REQUESTS_PATH],
      ['SystemAdmin', HR_LEAVE_REQUESTS_PATH],
      ['CEO', CEO_LEAVE_REQUESTS_PATH],
    ] as [Role, string][]) {
      const { client, calls } = fakeClient(() => emptyPage);
      await loadLeaveApprovals(approverRole, client);
      expect(calls[0].path.startsWith(expected)).toBe(true);
    }
  });

  it('calls nothing at all for a role with no approval surface', async () => {
    const { client, calls } = fakeClient();
    await expect(loadLeaveApprovals('Employee', client)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('decisions', () => {
  it('posts an HR approval to the id-scoped action path', async () => {
    const { client, calls } = fakeClient(() => ({}));
    const outcome = await approveHrLeave(1, '', client);

    expect(outcome).toEqual({ status: 'success' });
    expect(calls[0]).toMatchObject({
      path: `${HR_LEAVE_REQUESTS_PATH}1/approve/`,
      method: 'POST',
      body: { comment: '' },
    });
  });

  it('sends the optional CEO waiver alongside the approval', async () => {
    const { client, calls } = fakeClient(() => ({}));
    await approveCeoLeave(4, 'ok', 'obligations settled offline', client);

    expect(calls[0]).toMatchObject({
      path: `${CEO_LEAVE_REQUESTS_PATH}4/approve/`,
      body: { comment: 'ok', waiver_reason: 'obligations settled offline' },
    });
  });

  it('refuses an empty rejection reason before any request is sent', async () => {
    for (const reject of [rejectHrLeave, rejectCeoLeave]) {
      const { client, calls } = fakeClient(() => ({}));
      const outcome = await reject(1, '   ', client);

      expect(outcome).toEqual({
        status: 'failed',
        messageKey: 'approvals.rejectReasonRequired',
        details: [],
      });
      expect(calls).toHaveLength(0);
    }
  });

  it('trims the reason it does send', async () => {
    const { client, calls } = fakeClient(() => ({}));
    await rejectHrLeave(2, '  not enough notice  ', client);

    expect(calls[0]).toMatchObject({
      path: `${HR_LEAVE_REQUESTS_PATH}2/reject/`,
      body: { comment: 'not enough notice' },
    });
  });

  it('maps server validation text through the sanitized channel', async () => {
    const { client } = fakeClient(
      () => new ApiError('validation_failed', 422, ['Request is not in a state to be approved.']),
    );
    const outcome = await approveHrLeave(1, '', client);

    expect(outcome).toEqual({
      status: 'failed',
      messageKey: 'state.validationFailed',
      details: ['Request is not in a state to be approved.'],
    });
  });

  it('reports a forbidden decision as an access failure', async () => {
    const { client } = fakeClient(() => new ApiError('forbidden', 403));

    await expect(approveHrLeave(1, '', client)).resolves.toEqual({
      status: 'failed',
      messageKey: 'state.unauthorizedBody',
      details: [],
    });
  });

  it('lets an expired session propagate to the session handler', async () => {
    const { client } = fakeClient(() => new ApiError('session_expired', 401));

    await expect(approveHrLeave(1, '', client)).rejects.toBeInstanceOf(ApiError);
  });

  it('dispatches the decision endpoint from the approver identity alone', async () => {
    for (const [approverRole, expected] of [
      ['HRManager', `${HR_LEAVE_REQUESTS_PATH}3/approve/`],
      ['CEO', `${CEO_LEAVE_REQUESTS_PATH}3/approve/`],
    ] as [Role, string][]) {
      const { client, calls } = fakeClient(() => ({}));
      await actOnLeaveApproval(approverRole, 3, { action: 'approve' }, client);
      expect(calls[0].path).toBe(expected);
    }
  });

  it('refuses to act for a role with no approval surface', async () => {
    const { client, calls } = fakeClient();
    const outcome = await actOnLeaveApproval('Employee', 3, { action: 'approve' }, client);

    expect(outcome).toEqual({
      status: 'failed',
      messageKey: 'state.unauthorizedBody',
      details: [],
    });
    expect(calls).toHaveLength(0);
  });
});
