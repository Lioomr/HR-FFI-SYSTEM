export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "PENDING"
  | "PENDING_HR"
  | "PENDING_MGR"
  | "PENDING_CEO"
  | "REJECTED";
export type AttendanceSource = "EMPLOYEE" | "HR" | "SYSTEM";

export interface AttendanceRecord {
  id: string | number;
  employee_profile?: number;
  employee_name?: string;
  employee_name_en?: string | null;
  employee_name_ar?: string | null;
  employee_email?: string;
  date: string; // YYYY-MM-DD
  check_in_at: string | null;
  check_out_at: string | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  /** Device employee code that produced this record (SYSTEM/BioTime records only). */
  biotime_emp_code?: string | null;
  /** Serial number of the BioTime terminal that produced this record. */
  biotime_terminal_sn?: string | null;
  is_overridden: boolean;
  override_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceFilters {
  /** Exact-day filter; mutually exclusive with date_from/date_to on the backend. */
  date?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
  status?: AttendanceStatus;
  source?: AttendanceSource;
  employee_id?: number | string;
  search?: string;
}
