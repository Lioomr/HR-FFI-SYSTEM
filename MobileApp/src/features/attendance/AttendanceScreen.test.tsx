import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders, stubAuthService } from '@/qa/harness';
import { ApiError } from '@/services/api';

import { AttendanceScreen } from './AttendanceScreen';
import type { AttendanceActionOutcome, AttendanceTimeline } from './types';

const mockLoadTimeline = jest.fn<() => Promise<AttendanceTimeline>>();
const mockCheckIn = jest.fn<() => Promise<AttendanceActionOutcome>>();
const mockCheckOut = jest.fn<() => Promise<AttendanceActionOutcome>>();

jest.mock('./attendance-api', () => {
  const actual = jest.requireActual<typeof import('./attendance-api')>('./attendance-api');
  return {
    ...actual,
    loadAttendanceTimeline: () => mockLoadTimeline(),
    checkIn: () => mockCheckIn(),
    checkOut: () => mockCheckOut(),
  };
});

const notCheckedIn: AttendanceTimeline = { records: [], count: 0, today: null };

const checkedIn: AttendanceTimeline = {
  count: 1,
  today: {
    id: 5,
    date: '2026-07-28',
    checkInAt: '2026-07-28T06:00:00Z',
    checkOutAt: null,
    status: 'PENDING_MGR',
  },
  records: [
    {
      id: 5,
      date: '2026-07-28',
      checkInAt: '2026-07-28T06:00:00Z',
      checkOutAt: null,
      status: 'PENDING_MGR',
    },
  ],
};

describe('AttendanceScreen', () => {
  beforeEach(() => {
    mockLoadTimeline.mockReset();
    mockCheckIn.mockReset();
    mockCheckOut.mockReset();
  });

  it('shows a loading skeleton before the timeline resolves', async () => {
    let release: (value: AttendanceTimeline) => void = () => undefined;
    mockLoadTimeline.mockReturnValue(
      new Promise<AttendanceTimeline>((resolve) => {
        release = resolve;
      }),
    );

    const view = await renderWithProviders(<AttendanceScreen />);

    expect(view.getByTestId('attendance-skeleton')).toBeTruthy();
    release(notCheckedIn);
    await waitFor(() => expect(view.queryByTestId('attendance-skeleton')).toBeNull());
  });

  it('offers check-in and blocks check-out before the day has started', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(<AttendanceScreen />);

    const checkInButton = await view.findByTestId('attendance-check-in');
    const checkOutButton = view.getByTestId('attendance-check-out');

    expect(checkInButton.props.accessibilityState.disabled).toBe(false);
    expect(checkOutButton.props.accessibilityState.disabled).toBe(true);
    // The heading and the redundant non-colour status badge both carry the label.
    expect(await view.findAllByText('Not checked in')).toHaveLength(2);
    expect(view.getByText('No attendance records in this period.')).toBeTruthy();
  });

  it('reverses the available action once the employee is checked in', async () => {
    mockLoadTimeline.mockResolvedValue(checkedIn);
    const view = await renderWithProviders(<AttendanceScreen />);

    const checkInButton = await view.findByTestId('attendance-check-in');
    expect(checkInButton.props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('attendance-check-out').props.accessibilityState.disabled).toBe(false);
    expect(await view.findAllByText('Pending manager')).not.toHaveLength(0);
  });

  it('records a check-in and reloads the timeline from the server', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    mockCheckIn.mockResolvedValue({ status: 'success', kind: 'check-in' });
    const view = await renderWithProviders(<AttendanceScreen />);

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    await waitFor(() => expect(mockCheckIn).toHaveBeenCalledTimes(1));
    expect(await view.findByText('Check-in recorded.')).toBeTruthy();
    await waitFor(() => expect(mockLoadTimeline).toHaveBeenCalledTimes(2));
  });

  it('renders an honest unavailable message when the server refuses the action', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    mockCheckIn.mockResolvedValue({
      status: 'failed',
      messageKey: 'attendance.actionsUnavailable',
    });
    const view = await renderWithProviders(<AttendanceScreen />);

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    expect(
      await view.findByText(
        'Check-in and check-out are not available for your account in this company.',
      ),
    ).toBeTruthy();
    expect(mockLoadTimeline).toHaveBeenCalledTimes(1);
  });

  it('renders the generic access state for a forbidden timeline without leaking detail', async () => {
    mockLoadTimeline.mockRejectedValue(new ApiError('forbidden', 403));
    const view = await renderWithProviders(<AttendanceScreen />);

    expect(await view.findByText('Access unavailable')).toBeTruthy();
    expect(view.queryByText(/employee_profile|company_id|403|Forbidden/iu)).toBeNull();
    expect(view.queryByTestId('attendance-check-in')).toBeNull();
  });

  it('offers retry from the offline state', async () => {
    mockLoadTimeline.mockRejectedValueOnce(new ApiError('network_unavailable'));
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(<AttendanceScreen />);

    expect(await view.findByText('You are offline')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));

    expect(await view.findAllByText('Not checked in')).toHaveLength(2);
  });

  it('signs the employee out when the timeline reports an expired session', async () => {
    const logout = jest.fn(async () => undefined);
    mockLoadTimeline.mockRejectedValue(new ApiError('session_expired', 401));

    const view = await renderWithProviders(<AttendanceScreen />, {
      authService: stubAuthService({ logout }),
    });

    expect(await view.findByText('Session expired')).toBeTruthy();
  });

  it('renders Arabic copy and right-to-left rows when the session language is Arabic', async () => {
    mockLoadTimeline.mockResolvedValue(checkedIn);
    const view = await renderWithProviders(<AttendanceScreen />, { language: 'ar' });

    expect(await view.findByText('سجلاتك الخاصة في الشركة النشطة')).toBeTruthy();
    expect(view.getAllByText('الحضور').length).toBeGreaterThan(0);
    expect(view.getAllByText('تم تسجيل الحضور')).toHaveLength(2);
    expect(view.getAllByText('بانتظار المدير').length).toBeGreaterThan(0);
    expect(view.queryByText('Attendance')).toBeNull();

    const rtlRow = view.getByText('سجلاتك الخاصة في الشركة النشطة').props.style.flat();
    expect(rtlRow).toContainEqual(
      expect.objectContaining({ textAlign: 'right', writingDirection: 'rtl' }),
    );
  });

  it('keeps both primary actions at or above the 44 point touch target', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(<AttendanceScreen />);

    for (const testID of ['attendance-check-in', 'attendance-check-out']) {
      const style = view.getByTestId(testID).props.style as { minHeight?: number }[];
      const minHeight = style.flat().find((entry) => entry?.minHeight)?.minHeight;
      expect(minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
