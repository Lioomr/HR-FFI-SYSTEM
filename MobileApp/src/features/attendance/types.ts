export interface AttendanceRecord {
  id: number | string | null;
  date: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string | null;
}

export interface AttendanceTimeline {
  records: AttendanceRecord[];
  count: number;
  /** The record for the local calendar day, when the server returned one. */
  today: AttendanceRecord | null;
}

export type AttendanceDayState = 'not-checked-in' | 'checked-in' | 'checked-out';

export type AttendanceActionKind = 'check-in' | 'check-out';

export type AttendanceActionOutcome =
  | { status: 'success'; kind: AttendanceActionKind }
  | { status: 'failed'; messageKey: AttendanceFailureKey };

export type AttendanceFailureKey =
  | 'attendance.actionsUnavailable'
  | 'attendance.alreadyCheckedIn'
  | 'attendance.alreadyCheckedOut'
  | 'attendance.duplicate'
  | 'attendance.invalidLocation'
  | 'attendance.locationPermissionDenied'
  | 'attendance.locationUnavailable'
  | 'attendance.missingCheckIn'
  | 'attendance.outsideWorkLocation'
  | 'attendance.poorAccuracy'
  | 'attendance.rateLimited'
  | 'lock.attendanceFailed'
  | 'lock.unprotectedBody'
  | 'state.actionFailed'
  | 'state.offlineBody';
