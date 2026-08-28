import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * Annual Leave settlement (accrual payment) API.
 *
 * Backend: `Backend/leaves/views.py::AnnualLeavePaymentRequestViewSet`, routed
 * by `Backend/leaves/urls.py` under `/api/leaves/annual-leave-payments/`.
 *
 * The workflow is employee -> HR -> CEO:
 *   `pending_hr` -> (HR review) -> `pending_ceo` -> `approved` | `carried_forward` | `rejected`
 *
 * HR may also open a settlement directly for an employee who never submitted
 * one; that request is created already at `pending_ceo`.
 */

export const ANNUAL_LEAVE_PAYMENT_STATUSES = [
  "pending_hr",
  "pending_ceo",
  "approved",
  "rejected",
  "carried_forward",
] as const;

export type AnnualLeavePaymentStatus =
  (typeof ANNUAL_LEAVE_PAYMENT_STATUSES)[number];

/** `pay` settles in cash; `carry_forward` moves the days into the next cycle. */
export type AnnualLeavePaymentResolution = "pay" | "carry_forward";

/** HR's two options while the request sits at `pending_hr`. */
export type AnnualLeavePaymentReviewDecision = "forward" | "carry_forward";

/**
 * Decimal fields are serialised by DRF as strings (`"12.25"`). They are typed
 * as `string | number` so callers normalise once, with `toDecimalNumber`,
 * instead of trusting either shape.
 */
export interface AnnualLeavePaymentRequest {
  id: number;
  /** EmployeeProfile id — the value `employee_profile` filters on. */
  employee_id: number | null;
  employee_name: string | null;
  company: number | null;
  cycle_start: string;
  cycle_end: string;
  accrued_days: string | number;
  used_days: string | number;
  eligible_unused_days: string | number;
  /** Remainder below a whole day; never payable, shown for information only. */
  fractional_days: string | number;
  /**
   * Server-owned flag: the employee has an Annual Leave request in one of the
   * reserving states (`submitted`, `pending_delegate`, `pending_manager`,
   * `pending_hr`, `pending_ceo`, `pending_hr_completion`). Never infer this
   * from other endpoints — read it from the settlement record.
   */
  has_pending_annual_leave: boolean;
  salary_at_year_end: string | number;
  payment_amount: string | number;
  carry_forward_days: string | number;
  resolution: AnnualLeavePaymentResolution;
  status: AnnualLeavePaymentStatus;
  is_termination_settlement: boolean;
  employee_note: string;
  hr_review_note: string;
  ceo_decision_note: string;
  submitted_by: number | null;
  hr_reviewed_by: number | null;
  ceo_decided_by: number | null;
  submitted_at: string;
  hr_reviewed_at: string | null;
  ceo_decided_at: string | null;
  settled_at: string | null;
}

/**
 * Server-owned eligibility preview for the employee's own Annual Leave payment.
 *
 * Every figure here is calculated by
 * `Backend/leaves/utils.py::build_annual_leave_eligibility`. The frontend
 * renders these values and nothing else: no balance, amount, salary, or
 * contract date is derived in the browser.
 */
export interface AnnualLeaveEligibility {
  /** The only gate on offering the action. */
  can_request: boolean;
  /** Inside the final five days of the contract year (or terminated). */
  window_open: boolean;
  cycle_start: string | null;
  cycle_end: string | null;
  eligible_unused_days: string | number;
  fractional_days: string | number;
  salary_at_year_end: string | number;
  estimated_payment_amount: string | number;
  has_pending_annual_leave: boolean;
  /** Why the request is unavailable; blank when `can_request` is true. */
  reason: string;
}

export interface AnnualLeavePaymentFilter {
  status?: AnnualLeavePaymentStatus;
  resolution?: AnnualLeavePaymentResolution;
  /** EmployeeProfile id, matching the backend `employee_profile` filter field. */
  employee_profile?: number;
  ordering?: string;
  page?: number;
  page_size?: number;
}

/** Employee self-service submission; the backend derives every figure. */
export interface CreateEmployeeAnnualLeavePaymentPayload {
  employee_note?: string;
}

/**
 * HR-opened settlement for an employee who never submitted a request. The
 * backend creates it already at `pending_ceo`.
 */
export interface CreateHRAnnualLeaveSettlementPayload {
  employee_id: number;
  decision: AnnualLeavePaymentResolution;
  termination_date?: string;
}

export interface AnnualLeavePaymentReviewPayload {
  decision: AnnualLeavePaymentReviewDecision;
  comment?: string;
}

/** Reads a DRF decimal string (or number) as a number, defaulting to 0. */
export function toDecimalNumber(
  value: string | number | null | undefined,
): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAnnualLeavePaymentRequests(
  params?: AnnualLeavePaymentFilter,
): Promise<ApiResponse<PaginatedResponse<AnnualLeavePaymentRequest>>> {
  const { data } = await api.get<
    ApiResponse<PaginatedResponse<AnnualLeavePaymentRequest>>
  >("/api/leaves/annual-leave-payments/", { params });
  return data;
}

/** The viewset overrides `retrieve` to return the standard success envelope. */
export async function getAnnualLeavePaymentRequest(
  id: string | number,
): Promise<ApiResponse<AnnualLeavePaymentRequest>> {
  const { data } = await api.get<ApiResponse<AnnualLeavePaymentRequest>>(
    `/api/leaves/annual-leave-payments/${id}/`,
  );
  return data;
}

/**
 * Reads the employee's own eligibility. Requires the self-service roles
 * (`Employee`, `Manager`, `HRManager`) — it is always about the caller, so it
 * takes no employee argument.
 */
export async function getAnnualLeaveEligibility(): Promise<
  ApiResponse<AnnualLeaveEligibility>
> {
  const { data } = await api.get<ApiResponse<AnnualLeaveEligibility>>(
    "/api/leaves/annual-leave-payments/eligibility/",
  );
  return data;
}

export async function createEmployeeAnnualLeavePaymentRequest(
  payload: CreateEmployeeAnnualLeavePaymentPayload,
): Promise<ApiResponse<AnnualLeavePaymentRequest>> {
  const { data } = await api.post<ApiResponse<AnnualLeavePaymentRequest>>(
    "/api/leaves/annual-leave-payments/",
    payload,
  );
  return data;
}

export async function createHRAnnualLeaveSettlement(
  payload: CreateHRAnnualLeaveSettlementPayload,
): Promise<ApiResponse<AnnualLeavePaymentRequest>> {
  const { data } = await api.post<ApiResponse<AnnualLeavePaymentRequest>>(
    "/api/leaves/annual-leave-payments/",
    payload,
  );
  return data;
}

/** HR review: `forward` sends it to the CEO to pay, `carry_forward` to carry. */
export async function reviewAnnualLeavePaymentRequest(
  id: string | number,
  payload: AnnualLeavePaymentReviewPayload,
): Promise<ApiResponse<AnnualLeavePaymentRequest>> {
  const { data } = await api.post<ApiResponse<AnnualLeavePaymentRequest>>(
    `/api/leaves/annual-leave-payments/${id}/review/`,
    payload,
  );
  return data;
}

export async function approveAnnualLeavePaymentRequest(
  id: string | number,
  comment?: string,
): Promise<ApiResponse<AnnualLeavePaymentRequest>> {
  const { data } = await api.post<ApiResponse<AnnualLeavePaymentRequest>>(
    `/api/leaves/annual-leave-payments/${id}/approve/`,
    { comment },
  );
  return data;
}

/** The backend rejects an empty comment with a 422, so it is required here. */
export async function rejectAnnualLeavePaymentRequest(
  id: string | number,
  comment: string,
): Promise<ApiResponse<AnnualLeavePaymentRequest>> {
  const { data } = await api.post<ApiResponse<AnnualLeavePaymentRequest>>(
    `/api/leaves/annual-leave-payments/${id}/reject/`,
    { comment },
  );
  return data;
}
