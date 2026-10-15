import type {
  ValidationIssue,
  ValidationReport,
  ValidationSeverity,
  PayrollRunItemDto,
} from "../../services/api/payrollTypes";

/**
 * Groups validation issues by severity and code, so a code that hits many
 * employees (for example attendance_source_unavailable) is ONE card with a
 * table, never one row per employee at the top level.
 *
 * attendance_source_unavailable may appear twice with the same code: as the
 * coverage warning, and as a blocking error when manual confirmation is
 * required (params.manual_confirmation_required = true). Those are separate
 * groups because they ask HR for different things.
 */
export interface ValidationGroup {
  key: string;
  code: string;
  severity: ValidationSeverity | "info";
  manualConfirmation: boolean;
  issues: ValidationIssue[];
  /** Distinct employees in the group (run-level issues are not counted). */
  employeeCount: number;
}

export const ATTENDANCE_SOURCE_CODE = "attendance_source_unavailable";

export function isManualInformation(
  issue: ValidationIssue,
  items: PayrollRunItemDto[] | null,
) {
  return (
    issue.severity === "warning" &&
    issue.code === ATTENDANCE_SOURCE_CODE &&
    !!items?.find(
      (item) =>
        item.id === issue.employee?.item_id &&
        !item.executive_exempt &&
        item.absence.manual_confirmed,
    )
  );
}

export function validationPresentation(
  report: ValidationReport,
  items: PayrollRunItemDto[] | null,
) {
  const current =
    items && items.every((item) => item.run_revision === report.revision)
      ? items
      : null;
  const informational = report.warnings.filter((issue) =>
    isManualInformation(issue, current),
  ).length;
  const required = current?.filter(
    (item) =>
      !item.executive_exempt &&
      (item.absence.manual_confirmation_required ||
        !item.absence.source_available),
  );
  return {
    items: current,
    informational,
    warnings: report.counts.warnings - informational,
    blocking: report.counts.errors,
    progress: required
      ? {
          total: required.length,
          confirmed: required.filter((item) => item.absence.manual_confirmed)
            .length,
        }
      : null,
  };
}

function groupKey(issue: ValidationIssue, information: boolean) {
  const manual =
    issue.code === ATTENDANCE_SOURCE_CODE &&
    issue.params?.manual_confirmation_required === true;
  return {
    key: `${information ? "info" : issue.severity}:${issue.code}`,
    manual,
  };
}

export function groupValidationIssues(
  report: Pick<ValidationReport, "errors" | "warnings" | "infos">,
  items: PayrollRunItemDto[] | null = null,
): ValidationGroup[] {
  const groups = new Map<string, ValidationGroup>();
  for (const issue of [
    ...report.errors,
    ...report.warnings,
    ...(report.infos ?? []),
  ]) {
    const information = isManualInformation(issue, items);
    const { key, manual } = groupKey(issue, information);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        code: issue.code,
        severity: information ? "info" : issue.severity,
        manualConfirmation: manual,
        issues: [],
        employeeCount: 0,
      };
      groups.set(key, group);
    }
    group.issues.push(issue);
  }
  for (const group of groups.values()) {
    group.issues.sort(
      (a, b) =>
        (a.employee?.employee_id ?? "").localeCompare(
          b.employee?.employee_id ?? "",
        ) ||
        (a.employee?.employee_profile_id ?? 0) -
          (b.employee?.employee_profile_id ?? 0),
    );
    group.employeeCount = new Set(
      group.issues
        .map((issue) => issue.employee?.employee_profile_id)
        .filter((id) => id !== undefined && id !== null),
    ).size;
  }
  return [...groups.values()].sort(
    (a, b) =>
      ({ error: 0, warning: 1, info: 2 })[a.severity] -
        { error: 0, warning: 1, info: 2 }[b.severity] ||
      a.code.localeCompare(b.code),
  );
}

export function issueFixTarget(
  runId: number | string,
  issue: ValidationIssue,
  profiles: boolean,
) {
  if (
    /hire|archived|prehire|terminated/.test(issue.code) &&
    issue.employee &&
    profiles
  )
    return `/hr/employees/${issue.employee.employee_profile_id}`;
  if (/medical|invoice/.test(issue.code))
    return "/hr/payroll/settings?field=annual_medical_invoice";
  if (issue.employee?.item_id == null) return null;
  const field =
    issue.field?.replace(/^changes\./, "") ??
    (/absence|attendance/.test(issue.code)
      ? "absence_days_override"
      : /suspended/.test(issue.code)
        ? "suspended_pay_decision"
        : /zero/.test(issue.code)
          ? "zero_salary_reason"
          : "");
  const tab = /absence|attendance/.test(issue.code)
    ? "absence"
    : /accommodation|provision|gosi/.test(issue.code)
      ? "provisions"
      : "overview";
  return `/hr/payroll/${runId}/employees/${issue.employee.item_id}?tab=${tab}&field=${encodeURIComponent(field)}`;
}
