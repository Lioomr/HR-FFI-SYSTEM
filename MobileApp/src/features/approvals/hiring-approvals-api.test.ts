import { describe, expect, it, jest } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  actOnHiringApproval,
  canActOnHiringApproval,
  loadHiringApprovals,
  parseHiringRequestApproval,
} from './hiring-approvals-api';

function clientReturning(payload: unknown): ApiClient {
  return { request: jest.fn(async () => payload) } as unknown as ApiClient;
}

describe('hiring approvals API', () => {
  it('parses the verified serializer fields without a CV URL or file path', () => {
    expect(
      parseHiringRequestApproval({
        id: 7,
        reference_number: 'HRQ-FFI-2026-0007',
        candidate_full_name: 'Candidate Name',
        proposed_salary: '12000.00',
        status: 'submitted',
        requested_by_name: 'HR User',
        submitted_at: '2026-08-28T10:00:00Z',
      }),
    ).toMatchObject({
      id: 7,
      referenceNumber: 'HRQ-FFI-2026-0007',
      candidateFullName: 'Candidate Name',
      proposedSalary: 12000,
      status: 'submitted',
      requestedByName: 'HR User',
    });
  });

  it('offers both actions only for submitted CEO/SystemAdmin rows', () => {
    for (const action of ['approve', 'reject'] as const) {
      expect(canActOnHiringApproval('CEO', 'submitted', action)).toBe(true);
      expect(canActOnHiringApproval('SystemAdmin', 'submitted', action)).toBe(true);
      expect(canActOnHiringApproval('CEO', 'approved', action)).toBe(false);
      expect(canActOnHiringApproval('HRManager', 'submitted', action)).toBe(false);
      expect(canActOnHiringApproval('Manager', 'submitted', action)).toBe(false);
    }
  });

  it('does not fetch a CEO-only inbox for HR and sends the optional note when deciding', async () => {
    const client = clientReturning({ items: [] });
    await expect(loadHiringApprovals('HRManager', client)).resolves.toEqual([]);
    expect(client.request).not.toHaveBeenCalled();

    const decisionClient = clientReturning({ id: 7 });
    await expect(
      actOnHiringApproval('CEO', 7, 'reject', '  role paused  ', decisionClient),
    ).resolves.toEqual({
      status: 'success',
    });
    expect(decisionClient.request).toHaveBeenCalledWith('/hiring-requests/7/reject/', {
      method: 'POST',
      body: { note: 'role paused' },
    });
  });

  it('maps backend validation failures and preserves session expiry for the auth provider', async () => {
    const validation = {
      request: jest.fn(async () => {
        throw new ApiError('validation_failed', 422, ['Invalid decision.']);
      }),
    } as unknown as ApiClient;
    await expect(actOnHiringApproval('CEO', 7, 'approve', '', validation)).resolves.toEqual({
      status: 'failed',
      messageKey: 'state.validationFailed',
      details: ['Invalid decision.'],
    });

    const expired = {
      request: jest.fn(async () => {
        throw new ApiError('session_expired', 401);
      }),
    } as unknown as ApiClient;
    await expect(actOnHiringApproval('CEO', 7, 'approve', '', expired)).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
