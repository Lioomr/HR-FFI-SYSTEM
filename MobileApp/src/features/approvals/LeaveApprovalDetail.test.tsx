import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/qa/harness';

import { LeaveApprovalDetail } from './LeaveApprovalDetail';
import type { ApprovalLeaveRequest, ApprovalMutationOutcome } from './types';

const mockAct = jest.fn<(...args: unknown[]) => Promise<ApprovalMutationOutcome>>();
const mockUseAuth =
  jest.fn<() => { user: { role: string } | null; handleApiError: () => boolean }>();

jest.mock('./approvals-api', () => {
  const actual = jest.requireActual<typeof import('./approvals-api')>('./approvals-api');
  return {
    ...actual,
    actOnLeaveApproval: (...args: unknown[]) => mockAct(...args),
  };
});

jest.mock('@/providers', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/providers'),
  useAuth: () => mockUseAuth(),
}));

const request: ApprovalLeaveRequest = {
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

function signedInAs(role: string) {
  mockUseAuth.mockReturnValue({ user: { role }, handleApiError: () => false });
}

function render(overrides: Partial<ApprovalLeaveRequest> = {}, onDecided = () => undefined) {
  return renderWithProviders(
    <LeaveApprovalDetail
      onClose={() => undefined}
      onDecided={onDecided}
      request={{ ...request, ...overrides }}
    />,
  );
}

describe('LeaveApprovalDetail', () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockAct.mockResolvedValue({ status: 'success' });
  });

  it('shows the requester alongside the leave details', async () => {
    signedInAs('HRManager');
    const view = await render();

    expect(await view.findByText('Requested by')).toBeTruthy();
    expect(view.getAllByText('Test Employee').length).toBeGreaterThan(0);
    expect(view.getByText('Phase 2 approvals verification request')).toBeTruthy();
  });

  it('offers both HR actions on a request sitting at the HR stage', async () => {
    signedInAs('HRManager');
    const view = await render();

    expect(await view.findByTestId('approvals-approve')).toBeTruthy();
    expect(view.getByTestId('approvals-reject')).toBeTruthy();
  });

  it('offers HR only the reject action at the manager stage', async () => {
    signedInAs('HRManager');
    const view = await render({ status: 'pending_manager' });

    expect(await view.findByTestId('approvals-reject')).toBeTruthy();
    expect(view.queryByTestId('approvals-approve')).toBeNull();
  });

  it('renders a decided request read-only with an explanation', async () => {
    signedInAs('HRManager');
    const view = await render({ status: 'approved' });

    expect(await view.findByText('This request is not at a stage you can act on.')).toBeTruthy();
    expect(view.queryByTestId('approvals-approve')).toBeNull();
    expect(view.queryByTestId('approvals-reject')).toBeNull();
  });

  it('hides HR-stage actions from a CEO session', async () => {
    signedInAs('CEO');
    const view = await render({ status: 'pending_hr' });

    expect(await view.findByTestId('approvals-leave-detail')).toBeTruthy();
    expect(view.queryByTestId('approvals-approve')).toBeNull();
  });

  it('lets the CEO act on a request awaiting them', async () => {
    signedInAs('CEO');
    const view = await render({ status: 'pending_ceo' });

    expect(await view.findByTestId('approvals-approve')).toBeTruthy();
    expect(view.getByTestId('approvals-reject')).toBeTruthy();
  });

  it('approves through the role-dispatched action', async () => {
    signedInAs('HRManager');
    const onDecided = jest.fn<() => undefined>();
    const view = await render({}, onDecided);

    await fireEvent.press(await view.findByTestId('approvals-approve'));

    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(1));
    expect(mockAct).toHaveBeenCalledWith('HRManager', 1, {
      action: 'approve',
      comment: undefined,
    });
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  });

  it('requires a reason before a rejection can be confirmed', async () => {
    signedInAs('HRManager');
    const view = await render();

    await fireEvent.press(await view.findByTestId('approvals-reject'));

    const confirm = await view.findByTestId('approvals-reject-confirm');
    await fireEvent.press(confirm);
    expect(mockAct).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByTestId('approvals-reject-reason'), '  too short notice ');
    await fireEvent.press(view.getByTestId('approvals-reject-confirm'));

    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(1));
    expect(mockAct).toHaveBeenCalledWith('HRManager', 1, {
      action: 'reject',
      comment: 'too short notice',
    });
  });

  it('surfaces server validation text without closing the sheet', async () => {
    signedInAs('HRManager');
    mockAct.mockResolvedValue({
      status: 'failed',
      messageKey: 'state.validationFailed',
      details: ['HR manager requests must be approved by CEO.'],
    });
    const view = await render();

    await fireEvent.press(await view.findByTestId('approvals-approve'));

    expect(await view.findByTestId('approvals-detail-error')).toBeTruthy();
    expect(view.getByText('HR manager requests must be approved by CEO.')).toBeTruthy();
    expect(view.getByTestId('approvals-leave-detail')).toBeTruthy();
  });
});
