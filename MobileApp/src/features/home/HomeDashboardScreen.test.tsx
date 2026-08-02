import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { HomeDashboardScreen, summarizeLeaveBalances } from './HomeDashboardScreen';
import type { HomeDashboardSnapshot } from './types';

const mockPush = jest.fn();
const mockHandleApiError = jest.fn();
const mockLoadHomeDashboard = jest.fn<() => Promise<HomeDashboardSnapshot>>();
let mockIsRTL = false;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    handleApiError: mockHandleApiError,
    user: { email: 'employee@example.com', full_name: 'Nora' },
  }),
}));
jest.mock('@/i18n', () => ({
  useLocalization: () => ({
    directionHelpers: {
      directionalIcon: { transform: [{ scaleX: mockIsRTL ? -1 : 1 }] },
      direction: mockIsRTL ? 'rtl' : 'ltr',
      isRTL: mockIsRTL,
      row: { flexDirection: mockIsRTL ? 'row-reverse' : 'row' },
      text: {
        textAlign: mockIsRTL ? 'right' : 'left',
        writingDirection: mockIsRTL ? 'rtl' : 'ltr',
      },
    },
    formatDate: (value: string) => `date:${value}`,
    formatNumber: (value: number) => String(value),
    formatTime: (value: string) => `time:${value}`,
    t: (key: string, values?: Record<string, string>) => {
      if (key === 'dashboard.greeting') return `Hello, ${values?.name}`;
      if (key === 'dashboard.viewLeave') return mockIsRTL ? 'عرض الإجازات' : 'View leave';
      if (key === 'leave.availableDays') return `${values?.count} days available`;
      if (key === 'notifications.unreadCount') return `${values?.count} unread notifications`;
      return key;
    },
  }),
}));
jest.mock('./home-api', () => ({ loadHomeDashboard: () => mockLoadHomeDashboard() }));

const snapshot: HomeDashboardSnapshot = {
  attendance: {
    status: 'ready',
    data: [
      {
        id: 1,
        date: '2026-07-21',
        checkInAt: '2026-07-21T08:00:00Z',
        checkOutAt: null,
        status: 'PENDING_MANAGER',
      },
    ],
  },
  leaveBalances: {
    status: 'ready',
    data: [{ leaveTypeId: 1, leaveType: 'Annual', remainingDays: 7.5 }],
  },
  announcements: {
    status: 'ready',
    data: [{ id: 2, title: 'Office update', contentPreview: null, createdAt: null }],
  },
  unreadNotifications: { status: 'ready', data: 2 },
};

describe('HomeDashboardScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockHandleApiError.mockClear();
    mockLoadHomeDashboard.mockReset();
    mockIsRTL = false;
  });

  it('keeps the backend leave-type order when collapsing the balance summary', () => {
    const balances = [
      { leaveTypeId: 1, leaveType: 'Annual', remainingDays: 7 },
      { leaveTypeId: 2, leaveType: 'Sick', remainingDays: 12 },
    ];

    expect(summarizeLeaveBalances(balances)).toEqual({
      headline: balances[0],
      otherTypes: 1,
    });
  });

  it('renders successful sections, safe placeholders, and a greeting from the authenticated user', async () => {
    mockLoadHomeDashboard.mockResolvedValue(snapshot);
    const { findAllByText, findByText } = await render(<HomeDashboardScreen />);

    expect(await findByText('Hello, Nora')).toBeTruthy();
    expect(await findByText('Annual')).toBeTruthy();
    expect(await findByText('7.5 days available')).toBeTruthy();
    expect(await findByText('Office update')).toBeTruthy();
    expect((await findAllByText('common.notAvailable')).length).toBeGreaterThan(0);
  });

  it('keeps successful data visible during a partial endpoint failure', async () => {
    mockLoadHomeDashboard.mockResolvedValue({
      ...snapshot,
      attendance: { status: 'error', kind: 'offline' },
    });
    const { findByText } = await render(<HomeDashboardScreen />);

    expect(await findByText('state.offlineTitle')).toBeTruthy();
    expect(await findByText('Annual')).toBeTruthy();
    expect(await findByText('Office update')).toBeTruthy();
  });

  it('navigates the prominent request action only to the Leave tab without parameters', async () => {
    mockLoadHomeDashboard.mockResolvedValue(snapshot);
    const { findByRole } = await render(<HomeDashboardScreen />);
    const action = await findByRole('button', { name: 'dashboard.requestLeave' });

    fireEvent.press(action);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/leave'));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('navigates the compact Leave balance card action to the Leave tab', async () => {
    mockLoadHomeDashboard.mockResolvedValue(snapshot);
    const view = await render(<HomeDashboardScreen />);
    const action = await view.findByTestId('home-leave-balance');

    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toContain('View leave');
    expect(await view.findByText('View leave')).toBeTruthy();

    fireEvent.press(action);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/leave'));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('keeps the Leave card action navigable and direction-aware in Arabic RTL', async () => {
    mockIsRTL = true;
    mockLoadHomeDashboard.mockResolvedValue(snapshot);
    const view = await render(<HomeDashboardScreen />);
    const action = await view.findByTestId('home-leave-balance');

    expect(action.props.accessibilityLabel).toContain('عرض الإجازات');
    expect(view.getByTestId('home-leave-balance-content').props.style.flat()).toContainEqual(
      expect.objectContaining({ flexDirection: 'row-reverse' }),
    );

    fireEvent.press(action);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/leave'));
  });

  it('marks a partial-section retry busy until the fresh dashboard request settles', async () => {
    let resolveRetry!: (value: HomeDashboardSnapshot) => void;
    const retry = new Promise<HomeDashboardSnapshot>((resolve) => {
      resolveRetry = resolve;
    });
    mockLoadHomeDashboard
      .mockResolvedValueOnce({
        ...snapshot,
        attendance: { status: 'error', kind: 'offline' },
      })
      .mockImplementationOnce(() => retry);
    const view = await render(<HomeDashboardScreen />);
    const retryButton = await view.findByRole('button', { name: 'common.retry' });

    fireEvent.press(retryButton);

    const busyButton = await view.findByRole('button', { name: 'common.retrying' });
    expect(busyButton.props.accessibilityState).toMatchObject({ busy: true, disabled: true });

    resolveRetry(snapshot);
    await waitFor(() => expect(view.queryByRole('button', { name: 'common.retrying' })).toBeNull());
    expect(await view.findByText('attendance.checkedIn')).toBeTruthy();
  });

  it('propagates a section session expiry to the authenticated route boundary', async () => {
    mockLoadHomeDashboard.mockResolvedValue({
      ...snapshot,
      unreadNotifications: { status: 'error', kind: 'session-expired' },
    });

    await render(<HomeDashboardScreen />);

    await waitFor(() =>
      expect(mockHandleApiError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'session_expired', status: 401 }),
      ),
    );
  });
});
