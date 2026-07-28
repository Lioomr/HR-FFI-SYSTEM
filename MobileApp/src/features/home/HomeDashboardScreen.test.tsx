import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { HomeDashboardScreen } from './HomeDashboardScreen';
import type { HomeDashboardSnapshot } from './types';

const mockPush = jest.fn();
const mockHandleApiError = jest.fn();
const mockLoadHomeDashboard = jest.fn<() => Promise<HomeDashboardSnapshot>>();

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
      directionalIcon: {},
      direction: 'ltr',
      isRTL: false,
      row: { flexDirection: 'row' },
      text: { textAlign: 'left', writingDirection: 'ltr' },
    },
    formatDate: (value: string) => `date:${value}`,
    formatNumber: (value: number) => String(value),
    formatTime: (value: string) => `time:${value}`,
    t: (key: string, values?: Record<string, string>) => {
      if (key === 'dashboard.greeting') return `Hello, ${values?.name}`;
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
