import { payrollData, payrollRequest } from "./payrollTransport";
import type {
  AccommodationAssignment,
  AccommodationReportProperty,
  CreateAssignmentRequest,
  HistoryParams,
  ListAssignmentsQuery,
  PageParams,
  PayrollHistoryEntry,
  PayrollPage,
  UpdateAssignmentRequest,
} from "./payrollTypes";

/**
 * Payroll accommodation assignments and the run allocation report (contract
 * section 7.5). Rents themselves stay in rentsApi (`/api/hr/rents/`).
 */

const assignmentPath = (id: number | string) =>
  `/payroll-accommodation-assignments/${id}/`;

/** GET /payroll-accommodation-assignments/ (is_active defaults to true server-side). */
export function listAssignments(
  query: ListAssignmentsQuery = {},
): Promise<PayrollPage<AccommodationAssignment>> {
  return payrollData({
    method: "GET",
    url: "/payroll-accommodation-assignments/",
    params: { ...query },
  });
}

/** POST /payroll-accommodation-assignments/ -> A (201); overlap is 409 assignment_overlap. */
export function createAssignment(
  payload: CreateAssignmentRequest,
): Promise<AccommodationAssignment> {
  return payrollData({
    method: "POST",
    url: "/payroll-accommodation-assignments/",
    data: payload,
  });
}

/** GET /payroll-accommodation-assignments/{id}/ -> A */
export function getAssignment(
  id: number | string,
): Promise<AccommodationAssignment> {
  return payrollData({ method: "GET", url: assignmentPath(id) });
}

/** PATCH /payroll-accommodation-assignments/{id}/ (reason required) -> A */
export function updateAssignment(
  id: number | string,
  payload: UpdateAssignmentRequest,
): Promise<AccommodationAssignment> {
  return payrollData({
    method: "PATCH",
    url: assignmentPath(id),
    data: payload,
  });
}

/** DELETE /payroll-accommodation-assignments/{id}/ with `{reason}` body -> 204 (soft delete). */
export async function deleteAssignment(
  id: number | string,
  reason: string,
): Promise<void> {
  await payrollRequest<void>({
    method: "DELETE",
    url: assignmentPath(id),
    data: { reason },
  });
}

/** GET /payroll-accommodation-assignments/{id}/history/ -> page of H */
export function listAssignmentHistory(
  id: number | string,
  query: HistoryParams = {},
): Promise<PayrollPage<PayrollHistoryEntry>> {
  return payrollData({
    method: "GET",
    url: `${assignmentPath(id)}history/`,
    params: { ...query },
  });
}

/** GET /payroll-runs/{run_id}/accommodation-report/ -> page of property reports */
export function getAccommodationReport(
  runId: number | string,
  query: PageParams & { rent_id?: number } = {},
): Promise<PayrollPage<AccommodationReportProperty>> {
  return payrollData({
    method: "GET",
    url: `/payroll-runs/${runId}/accommodation-report/`,
    params: { ...query },
  });
}
