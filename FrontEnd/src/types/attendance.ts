export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE";
export type AttendanceSource = "EMPLOYEE" | "HR" | "SYSTEM";

export interface AttendanceRecord {
  id: string | number;
  employee_profile?: number;
  employee_name?: string;
  employee_email?: string;
  date: string; // YYYY-MM-DD
  check_in_at: string | null;
  check_out_at: string | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  is_overridden: boolean;
  override_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceFilters {
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
  status?: AttendanceStatus;
  employee_id?: number | string;
}
