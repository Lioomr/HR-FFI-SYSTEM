export interface NotificationItem {
  id: number | string | null;
  title: string | null;
  message: string | null;
  category: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  count: number;
  unreadCount: number;
}

export interface AnnouncementItem {
  id: number | string | null;
  title: string | null;
  contentPreview: string | null;
  createdAt: string | null;
  createdByName: string | null;
  hasAttachment: boolean;
}

export interface AnnouncementDetail extends AnnouncementItem {
  content: string | null;
  announcementType: string | null;
  attachmentName: string | null;
}

export type NotificationsTab = 'notifications' | 'announcements';
