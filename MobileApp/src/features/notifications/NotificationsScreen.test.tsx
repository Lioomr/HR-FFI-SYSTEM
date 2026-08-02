import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { providerWrapper } from '@/qa/harness';
import { ApiError } from '@/services/api';

import { NotificationsScreen } from './NotificationsScreen';
import type { AnnouncementItem, NotificationPage } from './types';

const mockLoadNotifications = jest.fn<() => Promise<NotificationPage>>();
const mockLoadAnnouncements = jest.fn<() => Promise<AnnouncementItem[]>>();
const mockMarkRead = jest.fn<() => Promise<'success' | 'failed'>>();
const mockMarkAllRead = jest.fn<() => Promise<'success' | 'failed'>>();
const mockRefreshUnread = jest.fn(async () => undefined);
let mockUnreadCount = 1;

jest.mock('./notifications-api', () => {
  const actual = jest.requireActual<typeof import('./notifications-api')>('./notifications-api');
  return {
    ...actual,
    loadNotifications: () => mockLoadNotifications(),
    loadAnnouncements: () => mockLoadAnnouncements(),
    loadAnnouncementDetail: async () => ({
      id: 8,
      title: 'Office closure',
      contentPreview: null,
      content: 'The office will be closed on Sunday.',
      createdAt: '2026-07-25T09:00:00Z',
      createdByName: 'HR Team',
      hasAttachment: true,
      announcementType: 'GENERAL',
      attachmentName: 'notice.pdf',
    }),
    markNotificationRead: () => mockMarkRead(),
    markAllNotificationsRead: () => mockMarkAllRead(),
  };
});

jest.mock('@/providers/NotificationPollingProvider', () => ({
  useNotificationPolling: () => ({
    refresh: mockRefreshUnread,
    status: 'ready',
    unreadCount: mockUnreadCount,
  }),
}));

const page: NotificationPage = {
  count: 2,
  unreadCount: 1,
  items: [
    {
      id: 4,
      title: 'Leave approved',
      message: 'Your leave request was approved.',
      category: 'leave',
      isRead: false,
      readAt: null,
      createdAt: '2026-07-27T10:00:00Z',
    },
    {
      id: 3,
      title: 'Payslip ready',
      message: 'A new payslip is available.',
      category: 'payroll',
      isRead: true,
      readAt: '2026-07-26T08:00:00Z',
      createdAt: '2026-07-26T07:00:00Z',
    },
  ],
};

const announcements: AnnouncementItem[] = [
  {
    id: 8,
    title: 'Office closure',
    contentPreview: 'The office will close…',
    createdAt: '2026-07-25T09:00:00Z',
    createdByName: 'HR Team',
    hasAttachment: true,
  },
];

function renderScreen(options: Parameters<typeof providerWrapper>[0] = {}) {
  const Wrapper = providerWrapper(options);
  return render(<NotificationsScreen />, {
    wrapper: ({ children }: PropsWithChildren) => <Wrapper>{children}</Wrapper>,
  });
}

describe('NotificationsScreen', () => {
  beforeEach(() => {
    mockUnreadCount = 1;
    mockLoadNotifications.mockReset();
    mockLoadAnnouncements.mockReset();
    mockMarkRead.mockReset();
    mockMarkAllRead.mockReset();
    mockRefreshUnread.mockClear();
    mockLoadNotifications.mockResolvedValue(page);
    mockLoadAnnouncements.mockResolvedValue(announcements);
  });

  it('lists notifications with an accessible unread label, not colour alone', async () => {
    const view = await renderScreen();

    const unreadRow = await view.findByTestId('notification-4');
    expect(unreadRow.props.accessibilityLabel).toBe(
      'Unread. Leave approved. Your leave request was approved.',
    );
    expect(view.getByTestId('notification-3').props.accessibilityLabel).toContain('Read.');
    expect(view.getByText('1 unread notifications')).toBeTruthy();
  });

  it('switches between the notification and announcement segments', async () => {
    const view = await renderScreen();

    await view.findByTestId('notification-4');
    await fireEvent.press(view.getByTestId('notifications-tab-announcements'));

    expect(await view.findByTestId('announcement-8')).toBeTruthy();
    expect(view.queryByTestId('notification-4')).toBeNull();
    expect(
      view.getByTestId('notifications-tab-announcements').props.accessibilityState.selected,
    ).toBe(true);
  });

  it('marks a notification read when its detail is opened', async () => {
    mockMarkRead.mockResolvedValue('success');
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('notification-4'));

    expect(await view.findByTestId('notification-detail')).toBeTruthy();
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRefreshUnread).toHaveBeenCalled());
  });

  it('does not re-mark a notification that is already read', async () => {
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('notification-3'));

    expect(await view.findByTestId('notification-detail')).toBeTruthy();
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('marks everything read and reloads the list and the polled count', async () => {
    mockMarkAllRead.mockResolvedValue('success');
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('notifications-mark-all'));

    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLoadNotifications).toHaveBeenCalledTimes(2));
    expect(mockRefreshUnread).toHaveBeenCalled();
  });

  it('reports a failed mark-all without inventing success', async () => {
    mockMarkAllRead.mockResolvedValue('failed');
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('notifications-mark-all'));

    expect(await view.findByText('The action could not be completed. Try again.')).toBeTruthy();
  });

  it('hides the mark-all action when nothing is unread', async () => {
    mockUnreadCount = 0;
    const view = await renderScreen();

    await view.findByTestId('notification-4');
    expect(view.queryByTestId('notifications-mark-all')).toBeNull();
    expect(view.getByText('Everything is read.')).toBeTruthy();
  });

  it('opens announcement detail on demand and discloses the attachment honestly', async () => {
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('notifications-tab-announcements'));
    await fireEvent.press(await view.findByTestId('announcement-8'));

    expect(await view.findByTestId('announcement-detail')).toBeTruthy();
    expect(await view.findByText('The office will be closed on Sunday.')).toBeTruthy();
    expect(view.getByTestId('announcement-attachment-notice')).toBeTruthy();
  });

  it('renders the offline state for the notification list and keeps announcements reachable', async () => {
    mockLoadNotifications.mockRejectedValue(new ApiError('network_unavailable'));
    const view = await renderScreen();

    expect(await view.findByText('You are offline')).toBeTruthy();
    await fireEvent.press(view.getByTestId('notifications-tab-announcements'));
    expect(await view.findByTestId('announcement-8')).toBeTruthy();
  });

  it('renders the empty state when the recipient has no notifications', async () => {
    mockLoadNotifications.mockResolvedValue({ items: [], count: 0, unreadCount: 0 });
    mockUnreadCount = 0;
    const view = await renderScreen();

    expect(await view.findByText('You have no notifications.')).toBeTruthy();
  });

  it('renders the tab in Arabic', async () => {
    const view = await renderScreen({ language: 'ar' });

    expect(await view.findByText('التحديثات الخاصة بك في الشركة النشطة')).toBeTruthy();
    expect(view.getAllByText('غير مقروء').length).toBeGreaterThan(0);
    expect(view.queryByText('Unread')).toBeNull();
  });
});
