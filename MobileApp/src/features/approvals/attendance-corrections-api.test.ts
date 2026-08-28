import { describe, expect, it } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  actOnAttendanceCorrection,
  ATTENDANCE_CORRECTIONS_PATH,
  canActOnAttendanceCorrection,
  loadAttendanceCorrectionApprovals,
} from './attendance-corrections-api';

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

function fakeClient(payload: unknown = { items: [] }) {
  const calls: Call[] = [];
  const client = {
    async request(path: string, options?: { method?: string; body?: unknown }) {
      calls.push({ path, method: options?.method, body: options?.body });
      if (payload instanceof Error) throw payload;
      return payload;
    },
  } as unknown as ApiClient;
  return { calls, client };
}

describe('attendance correction approvals', () => {
  it('uses the same scoped collection but the correct server status for each role', async () => {
    for (const [role, suffix] of [
      ['Manager', '&status=pending_manager'],
      ['HRManager', '&status=pending_hr'],
      ['SystemAdmin', ''],
    ] as const) {
      const { calls, client } = fakeClient({
        items: [
          {
            id: 3,
            employee_name: 'Employee',
            date: '2026-09-02',
            status: role === 'HRManager' ? 'pending_hr' : 'pending_manager',
            reason: 'Missing checkout',
          },
        ],
      });
      await expect(loadAttendanceCorrectionApprovals(role, client)).resolves.toHaveLength(1);
      expect(calls[0].path).toBe(`${ATTENDANCE_CORRECTIONS_PATH}?page=1&page_size=25${suffix}`);
    }
  });

  it('reflects the independently verified role/status action matrix', () => {
    expect(canActOnAttendanceCorrection('Manager', 'pending_manager', 'approve')).toBe(true);
    expect(canActOnAttendanceCorrection('Manager', 'pending_hr', 'reject')).toBe(false);
    expect(canActOnAttendanceCorrection('HRManager', 'pending_manager', 'approve')).toBe(false);
    expect(canActOnAttendanceCorrection('HRManager', 'pending_hr', 'reject')).toBe(true);
    expect(canActOnAttendanceCorrection('SystemAdmin', 'pending_manager', 'approve')).toBe(true);
    expect(canActOnAttendanceCorrection('SystemAdmin', 'pending_hr', 'reject')).toBe(true);
    expect(canActOnAttendanceCorrection('CEO', 'pending_hr', 'approve')).toBe(false);
  });

  it('sends notes, requires them only for rejection, and surfaces sanitized validation', async () => {
    const empty = fakeClient();
    await expect(
      actOnAttendanceCorrection('Manager', 1, 'reject', ' ', empty.client),
    ).resolves.toEqual({
      status: 'failed',
      messageKey: 'approvals.rejectReasonRequired',
      details: [],
    });
    expect(empty.calls).toHaveLength(0);

    const approved = fakeClient({});
    await actOnAttendanceCorrection('Manager', 1, 'approve', ' confirmed ', approved.client);
    expect(approved.calls[0]).toEqual({
      path: `${ATTENDANCE_CORRECTIONS_PATH}1/approve/`,
      method: 'POST',
      body: { notes: 'confirmed' },
    });

    const rejected = fakeClient(new ApiError('validation_failed', 422, ['Already decided.']));
    await expect(
      actOnAttendanceCorrection('HRManager', 1, 'approve', '', rejected.client),
    ).resolves.toEqual({
      status: 'failed',
      messageKey: 'state.validationFailed',
      details: ['Already decided.'],
    });
  });
});
