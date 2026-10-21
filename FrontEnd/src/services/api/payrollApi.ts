import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import { payrollData, payrollRequest } from "./payrollTransport";
import type {
  CancelRunRequest,
  CancelRunResult,
  FinalizeRequest,
  FinalizeResult,
  GeneratePayslipsResult,
  ItemAdjustmentsParams,
  ListPayrollRunItemsQuery,
  ListPayrollRunsQuery,
  PayrollExportFormat,
  PayrollHistoryEntry,
  PayrollItemPatch,
  PayrollPage,
  PayrollRunDto,
  PayrollRunHistoryEntry,
  PayrollRunItemDto,
  PayrollRunSummaryDto,
  PayrollStatus,
  HistoryParams,
  RecalculateRequest,
  RecalculateResult,
  ValidationReport,
  ValidationReportQuery,
} from "./payrollTypes";

/**
 * Payroll runs, items and run actions (contract sections 7.2-7.4 and 7.6).
 * Paths mirror the contract exactly (root-mounted, trailing slash).
 *
 * The functions in "Contract API" return the unwrapped `data` and throw on
 * any error; parse errors with parsePayrollError(). The "Legacy" functions
 * keep their original names and envelope return type for pages not yet
 * reworked.
 */

// ─── Legacy type names (now the contract DTOs) ──────────────────────────────

export type PayrollRunStatus = PayrollStatus;
export type PayrollRun = PayrollRunDto;
export type PayrollRunItem = PayrollRunItemDto;
export type PayrollRunSummary = PayrollRunSummaryDto;
export type ListPayrollRunsParams = ListPayrollRunsQuery;
export type ListPayrollRunItemsParams = ListPayrollRunItemsQuery;
export type PayrollRunListResponse = PaginatedResponse<PayrollRun>;
export type PayrollRunItemListResponse = PaginatedResponse<PayrollRunItem>;

export interface CreatePayrollRunRequest {
  period_start: string;
  period_end: string;
}

const runPath = (runId: number | string) => `/payroll-runs/${runId}/`;
const itemPath = (runId: number | string, itemId: number | string) =>
  `${runPath(runId)}items/${itemId}/`;

// ─── Contract API ───────────────────────────────────────────────────────────

/** GET /payroll-runs/ (order -year,-month,-id). */
export function listPayrollRuns(
  query: ListPayrollRunsQuery = {},
): Promise<PayrollPage<PayrollRunDto>> {
  return payrollData({
    method: "GET",
    url: "/payroll-runs/",
    params: { ...query },
  });
}

/** POST /payroll-runs/ -> R (201). Duplicate period is a 409 with legacy string errors. */
export function createRun(
  payload: CreatePayrollRunRequest,
): Promise<PayrollRunDto> {
  return payrollData({ method: "POST", url: "/payroll-runs/", data: payload });
}

/** GET /payroll-runs/{run_id}/ -> R */
export function getRun(runId: number | string): Promise<PayrollRunDto> {
  return payrollData({ method: "GET", url: runPath(runId) });
}

/** GET /payroll-runs/{run_id}/items/ -> page of I */
export function listRunItems(
  runId: number | string,
  query: ListPayrollRunItemsQuery = {},
): Promise<PayrollPage<PayrollRunItemDto>> {
  return payrollData({
    method: "GET",
    url: `${runPath(runId)}items/`,
    params: { ...query },
  });
}

/** GET /payroll-runs/{run_id}/items/{item_id}/ -> I */
export function getRunItem(
  runId: number | string,
  itemId: number | string,
): Promise<PayrollRunItemDto> {
  return payrollData({ method: "GET", url: itemPath(runId, itemId) });
}

/** PATCH /payroll-runs/{run_id}/items/{item_id}/ (DRAFT only, sparse changes) -> I */
export function patchRunItem(
  runId: number | string,
  itemId: number | string,
  payload: PayrollItemPatch,
): Promise<PayrollRunItemDto> {
  return payrollData({
    method: "PATCH",
    url: itemPath(runId, itemId),
    data: payload,
  });
}

/** GET /payroll-runs/{run_id}/items/{item_id}/adjustments/ -> page of H */
export function listItemAdjustments(
  runId: number | string,
  itemId: number | string,
  query: ItemAdjustmentsParams = {},
): Promise<PayrollPage<PayrollHistoryEntry>> {
  return payrollData({
    method: "GET",
    url: `${itemPath(runId, itemId)}adjustments/`,
    params: { ...query },
  });
}

/** GET /payroll-runs/{run_id}/summary/ */
export function getRunSummary(
  runId: number | string,
): Promise<PayrollRunSummaryDto> {
  return payrollData({ method: "GET", url: `${runPath(runId)}summary/` });
}

/** GET /payroll-runs/{run_id}/validation-report/ -> V (nonpaginated) */
export function getValidationReport(
  runId: number | string,
  query: ValidationReportQuery = {},
): Promise<ValidationReport> {
  return payrollData({
    method: "GET",
    url: `${runPath(runId)}validation-report/`,
    params: { ...query },
  });
}

/** POST /payroll-runs/{run_id}/recalculate/ (DRAFT only) */
export function recalculateRun(
  runId: number | string,
  payload: RecalculateRequest,
): Promise<RecalculateResult> {
  return payrollData({
    method: "POST",
    url: `${runPath(runId)}recalculate/`,
    data: payload,
  });
}

/** POST /payroll-runs/{run_id}/finalize/ with revision and reason. */
export function finalizeRun(
  runId: number | string,
  payload: Omit<FinalizeRequest, "confirm">,
): Promise<FinalizeResult> {
  return payrollData({
    method: "POST",
    url: `${runPath(runId)}finalize/`,
    data: { confirm: true, ...payload },
  });
}

/** POST /payroll-runs/{run_id}/generate-payslips/ (body `{}` for compatibility). */
export function generateRunPayslips(
  runId: number | string,
): Promise<GeneratePayslipsResult> {
  return payrollData({
    method: "POST",
    url: `${runPath(runId)}generate-payslips/`,
    data: {},
  });
}

/** POST /payroll-runs/{run_id}/cancel/ (DRAFT only; idempotent when cancelled). */
export function cancelRun(
  runId: number | string,
  payload: CancelRunRequest,
): Promise<CancelRunResult> {
  return payrollData({
    method: "POST",
    url: `${runPath(runId)}cancel/`,
    data: payload,
  });
}

/** GET /payroll-runs/{run_id}/history/ */
export function listRunHistory(
  runId: number | string,
  query: HistoryParams & { action?: string } = {},
): Promise<PayrollPage<PayrollRunHistoryEntry>> {
  return payrollData({
    method: "GET",
    url: `${runPath(runId)}history/`,
    params: { ...query },
  });
}

/** GET /payroll-runs/{run_id}/export/?file_format= -> binary attachment */
export function exportRun(
  runId: number | string,
  format: PayrollExportFormat,
): Promise<Blob> {
  return payrollRequest<Blob>({
    method: "GET",
    url: `${runPath(runId)}export/`,
    params: { file_format: format },
    responseType: "blob",
  });
}

// ─── Legacy API (kept for pages not yet reworked) ───────────────────────────

/** Re-wraps a contract call in the legacy `{status, data}` envelope. */
async function asEnvelope<T>(call: Promise<T>): Promise<ApiResponse<T>> {
  return { status: "success", data: await call };
}

/** @deprecated use listPayrollRuns */
export function getPayrollRuns(
  params?: ListPayrollRunsParams,
): Promise<ApiResponse<PayrollRunListResponse>> {
  return asEnvelope(listPayrollRuns(params));
}

/** @deprecated use getRun */
export function getPayrollRunDetails(
  id: string | number,
): Promise<ApiResponse<PayrollRun>> {
  return asEnvelope(getRun(id));
}

/** @deprecated use createRun */
export function createPayrollRun(
  payload: CreatePayrollRunRequest,
): Promise<ApiResponse<PayrollRun>> {
  return asEnvelope(createRun(payload));
}

/** @deprecated use listRunItems */
export function getPayrollRunItems(
  runId: string | number,
  params?: ListPayrollRunItemsParams,
): Promise<ApiResponse<PayrollRunItemListResponse>> {
  return asEnvelope(listRunItems(runId, params));
}

/** @deprecated use finalizeRun (sends expected_revision and reason) */
export function finalizePayrollRun(
  runId: string | number,
): Promise<ApiResponse<FinalizeResult>> {
  return asEnvelope(finalizeRun(runId, {}));
}

/** @deprecated use generateRunPayslips */
export function generatePayslips(
  runId: string | number,
): Promise<ApiResponse<GeneratePayslipsResult>> {
  return asEnvelope(generateRunPayslips(runId));
}

/** @deprecated use getRunSummary */
export function getPayrollRunSummary(
  runId: string | number,
): Promise<ApiResponse<PayrollRunSummary>> {
  return asEnvelope(getRunSummary(runId));
}

/** @deprecated use exportRun */
export function exportPayrollReport(
  runId: string | number,
  format: PayrollExportFormat,
): Promise<Blob> {
  return exportRun(runId, format);
}
