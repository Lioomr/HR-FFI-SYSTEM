export type HomeSectionFailureKind = 'offline' | 'session-expired' | 'unavailable';

export type HomeSection<T> =
  { status: 'ready'; data: T } | { status: 'error'; kind: HomeSectionFailureKind };

export interface AttendanceRecordPreview {
  id: number | string | null;
  date: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string | null;
}

export interface LeaveBalancePreview {
  leaveTypeId: number | null;
  leaveType: string | null;
  remainingDays: number | null;
}

export interface AnnouncementPreview {
  id: number | string | null;
  title: string | null;
  contentPreview: string | null;
  createdAt: string | null;
}

export interface HomeDashboardSnapshot {
  attendance: HomeSection<AttendanceRecordPreview[]>;
  leaveBalances: HomeSection<LeaveBalancePreview[]>;
  announcements: HomeSection<AnnouncementPreview[]>;
  unreadNotifications: HomeSection<number>;
}
