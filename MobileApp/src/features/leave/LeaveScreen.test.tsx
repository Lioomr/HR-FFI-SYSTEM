import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/qa/harness';
import { ApiError } from '@/services/api';

import type { loadLeaveOverview } from './leave-api';
import { LeaveScreen } from './LeaveScreen';
import type { LeaveMutationOutcome } from './types';

type Overview = Awaited<ReturnType<typeof loadLeaveOverview>>;

const mockLoadOverview = jest.fn<() => Promise<Overview>>();
const mockSubmit = jest.fn<() => Promise<LeaveMutationOutcome>>();
const mockCancel = jest.fn<() => Promise<LeaveMutationOutcome>>();

jest.mock('./leave-api', () => {
  const actual = jest.requireActual<typeof import('./leave-api')>('./leave-api');
  return {
    ...actual,
    loadLeaveOverview: () => mockLoadOverview(),
    submitLeaveRequest: () => mockSubmit(),
    cancelLeaveRequest: () => mockCancel(),
  };
});

const overview: Overview = {
  year: 2026,
  balances: {
    status: 'ready',
    data: [{ leaveTypeId: 1, leaveType: 'Annual', totalDays: 21, usedDays: 5, remainingDays: 16 }],
  },
  requests: {
    status: 'ready',
    data: [
      {
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
      },
    ],
  },
  leaveTypes: {
    status: 'ready',
    data: [{ id: 1, name: 'Annual', code: 'ANNUAL', isActive: true }],
  },
};

describe('LeaveScreen', () => {
  beforeEach(() => {
    mockLoadOverview.mockReset();
    mockSubmit.mockReset();
    mockCancel.mockReset();
  });

  it('renders the balance, entitlement breakdown, and the employee’s own requests', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    const view = await renderWithProviders(<LeaveScreen />);

    expect(await view.findByText('16 days available')).toBeTruthy();
    expect(view.getByText('Entitlement: 21 · Used: 5')).toBeTruthy();
    expect(view.getByText('Balance for 2026')).toBeTruthy();
    expect(view.getAllByText('Annual').length).toBeGreaterThan(0);
    expect(view.getAllByText('Pending manager').length).toBeGreaterThan(0);
  });

  it('keeps the request list visible when only the balance section fails', async () => {
    mockLoadOverview.mockResolvedValue({
      ...overview,
      balances: { status: 'error', kind: 'forbidden' },
    });
    const view = await renderWithProviders(<LeaveScreen />);

    expect(await view.findByText('Access unavailable')).toBeTruthy();
    expect(view.getByTestId('leave-request-31')).toBeTruthy();
  });

  it('blocks submission and names each invalid field before any request is sent', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-open-form'));
    await fireEvent.changeText(await view.findByTestId('leave-start-date'), '2026-08-05');
    await fireEvent.changeText(view.getByTestId('leave-end-date'), '2026-08-01');
    await fireEvent.press(view.getByTestId('leave-submit'));

    expect(await view.findByText('Select a leave type.')).toBeTruthy();
    expect(view.getByText('The end date must not be before the start date.')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('submits a valid request and reloads the list from the server', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    mockSubmit.mockResolvedValue({ status: 'success' });
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-open-form'));
    await fireEvent.press(await view.findByTestId('leave-type-1'));
    await fireEvent.changeText(view.getByTestId('leave-start-date'), '2026-09-01');
    await fireEvent.changeText(view.getByTestId('leave-end-date'), '2026-09-03');
    await fireEvent.press(view.getByTestId('leave-submit'));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLoadOverview).toHaveBeenCalledTimes(2));
  });

  it('shows server validation text safely instead of a generic failure', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    mockSubmit.mockResolvedValue({
      status: 'failed',
      messageKey: 'state.validationFailed',
      details: ['You already have a pending or approved leave request for this period.'],
    });
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-open-form'));
    await fireEvent.press(await view.findByTestId('leave-type-1'));
    await fireEvent.changeText(view.getByTestId('leave-start-date'), '2026-09-01');
    await fireEvent.changeText(view.getByTestId('leave-end-date'), '2026-09-03');
    await fireEvent.press(view.getByTestId('leave-submit'));

    expect(await view.findByTestId('leave-form-error')).toBeTruthy();
    expect(
      view.getByText('You already have a pending or approved leave request for this period.'),
    ).toBeTruthy();
    expect(mockLoadOverview).toHaveBeenCalledTimes(1);
  });

  it('opens a request detail from memory without adding a route parameter', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-request-31'));

    expect(await view.findByTestId('leave-request-detail')).toBeTruthy();
    expect(view.getByText('Family trip')).toBeTruthy();
    expect(view.getByTestId('leave-cancel')).toBeTruthy();
  });

  it('cancels a pending request and refreshes the list', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    mockCancel.mockResolvedValue({ status: 'success' });
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-request-31'));
    await fireEvent.press(await view.findByTestId('leave-cancel'));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLoadOverview).toHaveBeenCalledTimes(2));
  });

  it('reports a rejected cancellation without closing the detail view', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    mockCancel.mockResolvedValue({
      status: 'failed',
      messageKey: 'leave.cancelOnlyPending',
      details: [],
    });
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-request-31'));
    await fireEvent.press(await view.findByTestId('leave-cancel'));

    expect(await view.findByTestId('leave-detail-error')).toBeTruthy();
    expect(mockLoadOverview).toHaveBeenCalledTimes(1);
  });

  it('hides the cancel action for a decided request', async () => {
    mockLoadOverview.mockResolvedValue({
      ...overview,
      requests: {
        status: 'ready',
        data: [
          {
            ...(overview.requests.status === 'ready' ? overview.requests.data[0] : ({} as never)),
            status: 'approved',
          },
        ],
      },
    });
    const view = await renderWithProviders(<LeaveScreen />);

    await fireEvent.press(await view.findByTestId('leave-request-31'));

    expect(await view.findByTestId('leave-request-detail')).toBeTruthy();
    expect(view.queryByTestId('leave-cancel')).toBeNull();
    expect(view.getByText('Only pending requests can be cancelled.')).toBeTruthy();
  });

  it('renders the whole tab in Arabic with right-to-left text', async () => {
    mockLoadOverview.mockResolvedValue(overview);
    const view = await renderWithProviders(<LeaveScreen />, { language: 'ar' });

    expect(await view.findByText('رصيدك وطلباتك الخاصة')).toBeTruthy();
    expect(view.getAllByText('طلب إجازة').length).toBeGreaterThan(0);
    expect(view.getAllByText('بانتظار المدير').length).toBeGreaterThan(0);
    expect(view.queryByText('Leave balance')).toBeNull();
  });

  it('signs the employee out when a section reports an expired session', async () => {
    mockLoadOverview.mockResolvedValue({
      ...overview,
      requests: { status: 'error', kind: 'session-expired' },
    });
    const view = await renderWithProviders(<LeaveScreen />);

    expect(await view.findByText('Session expired')).toBeTruthy();
  });

  it('renders a whole-screen failure when the overview request itself rejects', async () => {
    mockLoadOverview.mockRejectedValue(new ApiError('network_unavailable'));
    const view = await renderWithProviders(<LeaveScreen />);

    expect(await view.findByText('You are offline')).toBeTruthy();
    expect(view.queryByTestId('leave-open-form')).toBeNull();
  });
});
