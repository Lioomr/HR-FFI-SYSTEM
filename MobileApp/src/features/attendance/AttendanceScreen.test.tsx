import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { passingReauthentication, renderWithProviders, stubAuthService } from '@/qa/harness';
import type { Reauthenticate } from '@/services/biometrics';
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

    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    expect(view.getByTestId('attendance-skeleton')).toBeTruthy();
    release(notCheckedIn);
    await waitFor(() => expect(view.queryByTestId('attendance-skeleton')).toBeNull());
  });

  it('offers check-in and blocks check-out before the day has started', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

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
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    const checkInButton = await view.findByTestId('attendance-check-in');
    expect(checkInButton.props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('attendance-check-out').props.accessibilityState.disabled).toBe(false);
    expect(await view.findAllByText('Pending manager')).not.toHaveLength(0);
  });

  it('records a check-in and reloads the timeline from the server', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    mockCheckIn.mockResolvedValue({ status: 'success', kind: 'check-in' });
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

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
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    expect(
      await view.findByText(
        'Check-in and check-out are not available for your account in this company.',
      ),
    ).toBeTruthy();
    expect(mockLoadTimeline).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'attendance.locationPermissionDenied' as const,
      'Location access is required to check in and out. Enable it for this app in your device settings.',
    ],
    [
      'attendance.locationUnavailable' as const,
      'Your location could not be determined. Move to a more open area and try again.',
    ],
    ['attendance.outsideWorkLocation' as const, 'You are not at an approved work location.'],
    ['attendance.invalidLocation' as const, 'Your location could not be verified. Try again.'],
    [
      'attendance.poorAccuracy' as const,
      'Your location is not accurate enough yet. Wait a moment or move to a more open area, then try again.',
    ],
    ['attendance.alreadyCheckedIn' as const, 'Check-in is already recorded for today.'],
  ])('surfaces the %s state and does not reload the timeline', async (messageKey, copy) => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    mockCheckIn.mockResolvedValue({ status: 'failed', messageKey });
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    expect(await view.findByText(copy)).toBeTruthy();
    expect(mockLoadTimeline).toHaveBeenCalledTimes(1);
  });

  it('never shows a site name, coordinate, radius, or distance in the outside-site state', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    mockCheckIn.mockResolvedValue({
      status: 'failed',
      messageKey: 'attendance.outsideWorkLocation',
    });
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    await fireEvent.press(await view.findByTestId('attendance-check-in'));
    await view.findByText('You are not at an approved work location.');

    expect(
      view.queryByText(/\d+\.\d{4,}|metre|meters away|radius|Riyadh|Office|km\b/iu),
    ).toBeNull();
  });

  it('reports the missing check-in state from a check-out attempt', async () => {
    mockLoadTimeline.mockResolvedValue(checkedIn);
    mockCheckOut.mockResolvedValue({ status: 'failed', messageKey: 'attendance.missingCheckIn' });
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    await fireEvent.press(await view.findByTestId('attendance-check-out'));

    expect(await view.findByText('No check-in is recorded for today.')).toBeTruthy();
  });

  it('records a check-out and reloads the timeline on a successful inside-site action', async () => {
    mockLoadTimeline.mockResolvedValue(checkedIn);
    mockCheckOut.mockResolvedValue({ status: 'success', kind: 'check-out' });
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    await fireEvent.press(await view.findByTestId('attendance-check-out'));

    await waitFor(() => expect(mockCheckOut).toHaveBeenCalledTimes(1));
    expect(await view.findByText('Check-out recorded.')).toBeTruthy();
    await waitFor(() => expect(mockLoadTimeline).toHaveBeenCalledTimes(2));
  });

  it('renders the Arabic outside-site state when the session language is Arabic', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    mockCheckIn.mockResolvedValue({
      status: 'failed',
      messageKey: 'attendance.outsideWorkLocation',
    });
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
      { language: 'ar' },
    );

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    expect(await view.findByText('أنت لست في موقع عمل معتمد.')).toBeTruthy();
  });

  it('renders the generic access state for a forbidden timeline without leaking detail', async () => {
    mockLoadTimeline.mockRejectedValue(new ApiError('forbidden', 403));
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    expect(await view.findByText('Access unavailable')).toBeTruthy();
    expect(view.queryByText(/employee_profile|company_id|403|Forbidden/iu)).toBeNull();
    expect(view.queryByTestId('attendance-check-in')).toBeNull();
  });

  it('offers retry from the offline state', async () => {
    mockLoadTimeline.mockRejectedValueOnce(new ApiError('network_unavailable'));
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    expect(await view.findByText('You are offline')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));

    expect(await view.findAllByText('Not checked in')).toHaveLength(2);
  });

  it('signs the employee out when the timeline reports an expired session', async () => {
    const logout = jest.fn(async () => undefined);
    mockLoadTimeline.mockRejectedValue(new ApiError('session_expired', 401));

    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
      {
        authService: stubAuthService({ logout }),
      },
    );

    expect(await view.findByText('Session expired')).toBeTruthy();
  });

  it('renders Arabic copy and right-to-left rows when the session language is Arabic', async () => {
    mockLoadTimeline.mockResolvedValue(checkedIn);
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
      { language: 'ar' },
    );

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

  it('requires local re-authentication before an attendance action reaches the server', async () => {
    const denied: Reauthenticate = async () => ({ status: 'failed', reason: 'refused' });
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(<AttendanceScreen reauthenticate={denied} />);

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    expect(
      await view.findByText('Identity not confirmed. Attendance was not recorded.'),
    ).toBeTruthy();
    // The gate runs before location capture and before any request.
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(mockLoadTimeline).toHaveBeenCalledTimes(1);
  });

  it('blocks check-out on a refused challenge too', async () => {
    const denied: Reauthenticate = async () => ({ status: 'failed', reason: 'refused' });
    mockLoadTimeline.mockResolvedValue(checkedIn);
    const view = await renderWithProviders(<AttendanceScreen reauthenticate={denied} />);

    await fireEvent.press(await view.findByTestId('attendance-check-out'));

    expect(
      await view.findByText('Identity not confirmed. Attendance was not recorded.'),
    ).toBeTruthy();
    expect(mockCheckOut).not.toHaveBeenCalled();
  });

  it('refuses an unprotected device and says what to change', async () => {
    const unprotected: Reauthenticate = async () => ({
      status: 'failed',
      reason: 'unavailable',
    });
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(<AttendanceScreen reauthenticate={unprotected} />);

    await fireEvent.press(await view.findByTestId('attendance-check-in'));

    expect(
      await view.findByText(
        'This app needs a device passcode or biometric lock. Set one up in your device settings, then try again.',
      ),
    ).toBeTruthy();
    expect(mockCheckIn).not.toHaveBeenCalled();
  });

  it('keeps both primary actions at or above the 44 point touch target', async () => {
    mockLoadTimeline.mockResolvedValue(notCheckedIn);
    const view = await renderWithProviders(
      <AttendanceScreen reauthenticate={passingReauthentication} />,
    );

    for (const testID of ['attendance-check-in', 'attendance-check-out']) {
      const style = view.getByTestId(testID).props.style as { minHeight?: number }[];
      const minHeight = style.flat().find((entry) => entry?.minHeight)?.minHeight;
      expect(minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
