import type { ValidationIssue } from "../services/api/payrollTypes";

/** attendance_source_unavailable issue for one employee (warning, or the manual-confirmation error). */
export function attendanceIssue(
  profileId: number,
  manual = false,
): ValidationIssue {
  return {
    code: "attendance_source_unavailable",
    severity: manual ? "error" : "warning",
    message:
      "Attendance source does not cover the employed dates; HR must confirm manual absence days when required.",
    message_key: "payroll.validation.attendance_source_unavailable",
    employee: {
      employee_profile_id: profileId,
      employee_id: `EMP-${profileId}`,
      employee_name: `Employee ${profileId}`,
      item_id: profileId + 1000,
    },
    field: "absence_days_override",
    params: manual
      ? { manual_confirmation_required: true }
      : { uncovered_dates: ["2026-09-01", "2026-09-02"] },
  };
}
