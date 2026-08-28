import { describe, expect, it, jest } from '@jest/globals';

import type { ApiClient } from '@/services/api';

import {
  actOnLoanApproval,
  canActOnLoanApproval,
  canReferLoanToCeo,
  loadLoanApprovals,
} from './loan-approvals-api';

function client(): ApiClient {
  return { request: jest.fn(async () => ({ items: [] })) } as unknown as ApiClient;
}

describe('loan approvals API', () => {
  it('gates each actor to its verified pending stage', () => {
    expect(canActOnLoanApproval('HRManager', 'pending_hr', 'approve')).toBe(true);
    expect(canActOnLoanApproval('HRManager', 'pending_finance', 'reject')).toBe(true);
    expect(canActOnLoanApproval('CFO', 'pending_cfo', 'approve')).toBe(true);
    expect(canActOnLoanApproval('CEO', 'pending_ceo', 'reject')).toBe(true);
    expect(canActOnLoanApproval('CEO', 'pending_cfo', 'approve')).toBe(false);
    expect(canActOnLoanApproval('HRManager', 'pending_cfo', 'reject')).toBe(false);
    expect(canReferLoanToCeo('CFO', 'pending_cfo')).toBe(true);
  });

  it('uses role-scoped lists and requires a comment only where the backend does', async () => {
    const cfo = client();
    await loadLoanApprovals('CFO', cfo);
    expect(cfo.request).toHaveBeenCalledWith('/api/loans/cfo/loan-requests/?page=1&page_size=25');
    const decision = client();
    await expect(actOnLoanApproval('CFO', 4, 'reject', '', decision)).resolves.toMatchObject({
      status: 'failed',
    });
    await expect(actOnLoanApproval('HRManager', 4, 'reject', '', decision)).resolves.toEqual({
      status: 'success',
    });
    expect(decision.request).toHaveBeenCalledWith('/api/loans/hr/loan-requests/4/reject/', {
      method: 'POST',
      body: { comment: '' },
    });
  });
});
