import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders, stubAuthService, testUser } from '@/qa/harness';
import { ApiError } from '@/services/api';

import { ApprovalsScreen } from './ApprovalsScreen';
import type {
  ApprovalLeaveRequest,
  ApprovalMutationOutcome,
  AttendanceCorrectionApproval,
  DelegationCandidate,
  DelegationRule,
  HiringRequestApproval,
} from './types';

const mockLoad = jest.fn<() => Promise<ApprovalLeaveRequest[]>>();
const mockAct = jest.fn<() => Promise<ApprovalMutationOutcome>>();
const mockLoadDelegationRules = jest.fn<() => Promise<DelegationRule[]>>();
const mockLoadDelegationCandidates = jest.fn<() => Promise<DelegationCandidate[]>>();
const mockLoadAttendanceCorrections = jest.fn<() => Promise<AttendanceCorrectionApproval[]>>();
const mockLoadHiring = jest.fn<() => Promise<HiringRequestApproval[]>>();

jest.mock('./approvals-api', () => {
  const actual = jest.requireActual<typeof import('./approvals-api')>('./approvals-api');
  return {
    ...actual,
    loadLeaveApprovals: () => mockLoad(),
    actOnLeaveApproval: () => mockAct(),
  };
});

jest.mock('./delegations-api', () => {
  const actual = jest.requireActual<typeof import('./delegations-api')>('./delegations-api');
  return {
    ...actual,
    loadDelegationRules: () => mockLoadDelegationRules(),
    loadDelegationCandidates: () => mockLoadDelegationCandidates(),
  };
});

jest.mock('./attendance-corrections-api', () => {
  const actual = jest.requireActual<typeof import('./attendance-corrections-api')>(
    './attendance-corrections-api',
  );
  return {
    ...actual,
    loadAttendanceCorrectionApprovals: () => mockLoadAttendanceCorrections(),
  };
});

jest.mock('./hiring-approvals-api', () => {
  const actual =
    jest.requireActual<typeof import('./hiring-approvals-api')>('./hiring-approvals-api');
  return { ...actual, loadHiringApprovals: () => mockLoadHiring() };
});

const pendingHr: ApprovalLeaveRequest = {
  id: 1,
  employeeId: 1,
  employeeName: 'Test Employee',
  employeeEmail: 'employee.test@fficontracting.com',
  leaveTypeName: 'Unpaid Leave',
  startDate: '2026-11-02',
  endDate: '2026-11-04',
  status: 'pending_hr',
  days: 3,
  reason: 'Phase 2 approvals verification request',
  createdAt: '2026-08-27T21:28:14.495809Z',
  decisionReason: null,
  decidedAt: null,
};

/** Signs the harness in as an approver instead of the default employee. */
function asRole(role: string) {
  const user = { ...testUser, role };
  return {
    authService: stubAuthService({ login: async () => user, restoreSession: async () => user }),
  };
}

describe('ApprovalsScreen', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockAct.mockReset();
    mockLoadDelegationRules.mockReset();
    mockLoadDelegationCandidates.mockReset();
    mockLoadAttendanceCorrections.mockReset();
    mockLoadHiring.mockReset();
    mockLoadDelegationRules.mockResolvedValue([]);
    mockLoadDelegationCandidates.mockResolvedValue([]);
    mockLoadAttendanceCorrections.mockResolvedValue([]);
    mockLoadHiring.mockResolvedValue([]);
  });

  it('lists every request with its requester and stage for HR', async () => {
    mockLoad.mockResolvedValue([pendingHr, { ...pendingHr, id: 2, status: 'pending_ceo' }]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('HRManager'));

    expect(await view.findByTestId('approvals-request-1')).toBeTruthy();
    expect(view.getByTestId('approvals-request-2')).toBeTruthy();
    expect(view.getAllByText('Test Employee').length).toBeGreaterThan(0);
    expect(view.getByText('Pending HR')).toBeTruthy();
    expect(view.getByText('Pending CEO')).toBeTruthy();
  });

  it('shows an empty state when nothing awaits a decision', async () => {
    mockLoad.mockResolvedValue([]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('CEO'));

    expect(await view.findByText('Nothing is waiting for your decision.')).toBeTruthy();
  });

  it('shows a CEO the hiring section and keeps non-submitted rows read-only in its detail', async () => {
    mockLoad.mockResolvedValue([]);
    mockLoadHiring.mockResolvedValue([
      {
        id: 31,
        referenceNumber: 'HRQ-FFI-31',
        candidateFullName: 'Hiring Candidate',
        candidateEmail: null,
        candidatePhoneNumber: null,
        nationality: null,
        proposedSalary: null,
        status: 'approved',
        requestedByName: 'HR User',
        submittedAt: '2026-08-28T10:00:00Z',
        ceoDecisionByName: 'CEO User',
        ceoDecisionAt: '2026-08-28T11:00:00Z',
        ceoDecisionNote: null,
        createdAt: '2026-08-28T09:00:00Z',
      },
    ]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('CEO'));

    expect(await view.findByTestId('hiring-request-31')).toBeTruthy();
    await fireEvent.press(view.getByTestId('hiring-request-31'));
    expect(await view.findByTestId('hiring-request-detail')).toBeTruthy();
    expect(view.queryByTestId('hiring-request-approve')).toBeNull();
    expect(view.queryByTestId('hiring-request-reject')).toBeNull();
  });

  it('shows a manager only the attendance-correction stage they can act on', async () => {
    mockLoad.mockResolvedValue([]);
    mockLoadAttendanceCorrections.mockResolvedValue([
      {
        id: 14,
        employeeName: 'Correction Employee',
        employeeEmail: null,
        date: '2026-09-02',
        currentCheckInAt: null,
        currentCheckOutAt: null,
        currentStatus: 'PRESENT',
        requestedCheckInAt: null,
        requestedCheckOutAt: '2026-09-02T17:30:00Z',
        requestedStatus: null,
        reason: 'Forgot to check out',
        status: 'pending_manager',
        createdAt: '2026-09-02T08:00:00Z',
      },
    ]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('Manager'));

    expect(await view.findByTestId('attendance-correction-14')).toBeTruthy();
    expect(view.getByText('Attendance corrections')).toBeTruthy();
    expect(view.queryByText('Leave requests')).toBeNull();
  });

  it('offers no approvals surface to a role without one', async () => {
    mockLoad.mockResolvedValue([]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('Employee'));

    expect(await view.findByText('You do not have access to this information.')).toBeTruthy();
    expect(view.queryByTestId('approvals-skeleton')).toBeNull();
  });

  it('opens the detail from memory without adding a route parameter', async () => {
    mockLoad.mockResolvedValue([pendingHr]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('HRManager'));

    await fireEvent.press(await view.findByTestId('approvals-request-1'));

    expect(await view.findByTestId('approvals-leave-detail')).toBeTruthy();
    expect(view.getByText('Phase 2 approvals verification request')).toBeTruthy();
    expect(view.getByTestId('approvals-approve')).toBeTruthy();
  });

  it('opens delegation management on demand without adding a route', async () => {
    mockLoad.mockResolvedValue([]);
    mockLoadDelegationCandidates.mockResolvedValue([
      {
        id: 9,
        employeeId: 'EMP-9',
        fullName: 'Delegate Candidate',
        fullNameEn: 'Delegate Candidate',
        fullNameAr: null,
        canDelegate: true,
      },
    ]);
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('HRManager'));

    await fireEvent.press(await view.findByTestId('delegations-open'));

    expect(await view.findByTestId('delegations-sheet')).toBeTruthy();
    expect(view.getByTestId('delegation-candidate-9')).toBeTruthy();
    expect(mockLoadDelegationRules).toHaveBeenCalledTimes(1);
    expect(mockLoadDelegationCandidates).toHaveBeenCalledTimes(1);
  });

  it('approves a request and reloads the list from the server', async () => {
    mockLoad.mockResolvedValue([pendingHr]);
    mockAct.mockResolvedValue({ status: 'success' });
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('HRManager'));

    await fireEvent.press(await view.findByTestId('approvals-request-1'));
    // The session restore settles before the press, so the list count is stable here.
    const loadsBeforeDecision = mockLoad.mock.calls.length;
    await fireEvent.press(await view.findByTestId('approvals-approve'));

    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLoad.mock.calls.length).toBe(loadsBeforeDecision + 1));
    expect(view.queryByTestId('approvals-leave-detail')).toBeNull();
  });

  it('renders the whole tab in Arabic with right-to-left text', async () => {
    mockLoad.mockResolvedValue([pendingHr]);
    const view = await renderWithProviders(<ApprovalsScreen />, {
      ...asRole('HRManager'),
      language: 'ar',
    });

    expect(await view.findByText('طلبات الإجازة')).toBeTruthy();
    expect(view.getByText('بانتظار الموارد البشرية')).toBeTruthy();
    expect(view.queryByText('Leave requests')).toBeNull();
  });

  it('renders a whole-screen failure when the list request rejects', async () => {
    mockLoad.mockRejectedValue(new ApiError('network_unavailable'));
    const view = await renderWithProviders(<ApprovalsScreen />, asRole('HRManager'));

    expect(await view.findByText('You are offline')).toBeTruthy();
  });
});
