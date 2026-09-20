import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import { isApiError } from "./apiTypes";
import type { WorkflowSnapshot } from "../../types/workflow";
import type {
  ContractDecisionType,
  ContractSalaryTerms,
} from "./contractDecisionsApi";

/*
 * Employee Contract Rating.
 *
 * This backend app is mounted at the site root, NOT under `/api/` like every
 * other module (Backend/config/urls.py: `path("", include("contract_ratings.urls"))`).
 * Do not add an `/api` prefix to these paths.
 */
const BASE = "/contract-ratings";

export type RatingGrade =
  | "EXCELLENT"
  | "VERY_GOOD"
  | "GOOD"
  | "ACCEPTABLE"
  | "POOR";

/** Every member of `contract_ratings.models.ContractRating.Status`. */
export type ContractRatingStatus =
  | "PENDING_HR_GATE"
  | "PENDING_RESPONSES"
  | "WAITING_MANAGER"
  | "WAITING_EMPLOYEE"
  | "PENDING_CEO"
  | "DECIDED"
  | "MANUAL_RESOLUTION_REQUIRED";

/** HR's one-time routing choice; blank until HR decides the gate. */
export type RatingMode = "RATE" | "SKIP_TO_CEO";

/** Statuses in which the backend accepts a manager/employee (re)submission. */
export const RESPONSE_STATUSES: readonly ContractRatingStatus[] = [
  "PENDING_RESPONSES",
  "WAITING_MANAGER",
  "WAITING_EMPLOYEE",
];

/** The CEO's three contract outcomes reuse `ContractDecision.DecisionType`. */
export type CeoOutcome = ContractDecisionType;

/** Correction actions; rejected by the backend on a SKIP_TO_CEO rating. */
export type CeoReturnAction =
  | "RETURN_TO_MANAGER"
  | "RETURN_TO_EMPLOYEE"
  | "RETURN_TO_BOTH";

/** One criterion answer — the exact shape the backend validates. */
export interface CriterionRating {
  grade: RatingGrade;
  /** Integer inside the grade's inclusive range. */
  score: number;
  remark: string;
}

/** Keyed by criterion code; all criteria are required on every submission. */
export type CriterionRatings = Record<string, CriterionRating>;

export interface RatingCriterion {
  code: string;
  label_en: string;
  label_ar: string;
  display_order: number;
}

/** Inclusive `[min, max]` score range per grade. */
export type GradeRanges = Record<RatingGrade, [number, number]>;

export interface RatingCriteriaPayload {
  criteria: RatingCriterion[];
  grade_ranges: GradeRanges;
}

/** Header fields present in every role's payload. */
export interface ContractRatingHeader {
  id: number;
  status: ContractRatingStatus;
  rating_mode: RatingMode | "";
  company: number;
  employee: {
    id: number;
    employee_id: string;
    employee_number: string | null;
    full_name: string;
    department: string;
    section: string;
    job_title: string;
    manager_at_creation: number | null;
  };
  evaluation_period_from: string | null;
  evaluation_period_to: string | null;
  contract_date: string | null;
  contract_expiry: string | null;
  manager_name: string;
}

/**
 * One rater's response row. Manager and employee rows have the identical,
 * decision-free shape; averages are server-computed.
 */
export interface RatingResponse {
  id: number;
  rater_type: "MANAGER" | "EMPLOYEE";
  status: "SUBMITTED" | "RETURNED";
  submitted_by: number | null;
  submitted_by_name: string;
  criterion_ratings: CriterionRatings;
  /** Decimal string, e.g. "85.50". */
  average_score: string;
  overall_grade: RatingGrade;
  overall_remark: string;
  submitted_at: string | null;
  returned_at: string | null;
  returned_by: number | null;
  return_reason: string;
  created_at: string;
  updated_at: string;
}

/*
 * The backend's read serializer is role-shaped: each viewer role gets a
 * structurally different object, not one object with nulled-out fields. The
 * payload itself carries no role marker, so `toContractRatingView` classifies
 * it once by the keys only that shape has and stamps a client-side `viewer`
 * discriminant. Pages switch on `viewer` and TypeScript then refuses to read,
 * say, `manager_response` from an employee-shaped payload.
 */

/** The rated employee: header + own response only, never anything else. */
export interface EmployeeContractRatingView extends ContractRatingHeader {
  viewer: "employee";
  /** Employee payloads exist only for rated (not skipped) cycles. */
  rating_mode: "RATE";
  employee_response: RatingResponse | null;
}

/** The employee's manager: header + own response only. */
export interface ManagerContractRatingView extends ContractRatingHeader {
  viewer: "manager";
  rating_mode: "RATE";
  manager_response: RatingResponse | null;
}

/** Present on an HR coarse payload only while status is PENDING_HR_GATE. */
export interface HrGateFields {
  account_connected: boolean;
  hr_gate_decided_by: number | null;
  hr_gate_decided_by_name: string;
  hr_gate_decided_at: string | null;
}

/** Present on an HR coarse payload only once the CEO has decided. */
export interface CeoOutcomeFields {
  ceo_decision: CeoOutcome;
  ceo_comment: string;
  ceo_decided_at: string | null;
  ceo_decided_by: number | null;
  ceo_approved_terms: ContractSalaryTerms;
  salary_effective_date: string | null;
  salary_change_applied_at: string | null;
  salary_after_snapshot: ContractSalaryTerms;
  scheduled_termination: boolean;
  employee_notified_of_termination_at: string | null;
  employee_notified_of_termination_by: number | null;
  termination_processed_at: string | null;
}

/**
 * HR (or SystemAdmin) on a rating where the CEO has not requested a comment:
 * coarse status only. No scores, grades, remarks, comparison or workflow.
 */
export type HrCoarseContractRatingView = ContractRatingHeader & {
  viewer: "hr_coarse";
  hr_comment_requested_at: null;
  /** Gate decision support; present only while PENDING_HR_GATE. */
  gate: HrGateFields | null;
  /** Decision outcome; present only once the CEO has decided. */
  outcome: CeoOutcomeFields | null;
};

export interface RatingComparisonRow {
  manager_grade: RatingGrade;
  manager_score: number;
  employee_grade: RatingGrade;
  employee_score: number;
  /** manager_score − employee_score */
  difference: number;
}

/**
 * Built when both responses are submitted; `{}` otherwise (including after a
 * CEO return). Criterion codes map to rows; the four summary keys are strings.
 */
export type RatingComparisonSummary = {
  manager_average?: string;
  manager_overall_grade?: RatingGrade;
  employee_average?: string;
  employee_overall_grade?: RatingGrade;
} & Record<string, RatingComparisonRow | string | undefined>;

/** Fields common to the full CEO / comment-requested HR package. */
interface FullContractRatingBase extends ContractRatingHeader {
  viewer: "full";
  contract_decision: number;
  hr_gate_decided_by: number | null;
  hr_gate_decided_by_name: string;
  hr_gate_decided_at: string | null;
  manager_at_creation: number | null;
  department_snapshot: string;
  section_snapshot: string;
  job_title_snapshot: string;
  hr_comment_requested_by: number | null;
  hr_comment_requested_by_name: string;
  hr_comment_requested_at: string | null;
  hr_comment_by: number | null;
  hr_comment_by_name: string;
  hr_comment: string;
  hr_comment_submitted_at: string | null;
  ceo_decision: CeoOutcome | "";
  ceo_decided_by: number | null;
  ceo_decided_by_name: string;
  ceo_comment: string;
  ceo_decided_at: string | null;
  salary_before_snapshot: ContractSalaryTerms;
  ceo_approved_terms: ContractSalaryTerms;
  salary_effective_date: string | null;
  salary_change_applied_at: string | null;
  salary_after_snapshot: ContractSalaryTerms;
  /** Decimal string: approved total − base total ("0" before a decision). */
  salary_increase_amount: string;
  salary_increase_percent: string | null;
  scheduled_termination: boolean;
  employee_notified_of_termination_at: string | null;
  employee_notified_of_termination_by: number | null;
  termination_processed_at: string | null;
  /** Live `EmployeeProfile` salary terms. */
  current_terms: ContractSalaryTerms;
  remaining_contract_days: number | null;
  employment_status: string;
  is_archived: boolean;
  archive_reason: string;
  workflow: WorkflowSnapshot;
  created_at: string;
  updated_at: string;
}

/** A rated cycle: both evaluation panels and the comparison exist. */
export interface RatedFullContractRating extends FullContractRatingBase {
  rating_mode: "RATE" | "";
  manager_response: RatingResponse | null;
  employee_response: RatingResponse | null;
  comparison_summary: RatingComparisonSummary;
}

/**
 * HR sent the cycle straight to the CEO. The backend removes the evaluation
 * keys entirely — there is nothing to compare or return.
 */
export interface SkippedFullContractRating extends FullContractRatingBase {
  rating_mode: "SKIP_TO_CEO";
}

export type FullContractRating =
  | RatedFullContractRating
  | SkippedFullContractRating;

export type ContractRatingView =
  | EmployeeContractRatingView
  | ManagerContractRatingView
  | HrCoarseContractRatingView
  | FullContractRating;

type RawRating = Record<string, unknown>;

const GATE_KEYS = [
  "account_connected",
  "hr_gate_decided_by",
  "hr_gate_decided_by_name",
  "hr_gate_decided_at",
] as const;
const OUTCOME_KEYS = [
  "ceo_decision",
  "ceo_comment",
  "ceo_decided_at",
  "ceo_decided_by",
  "ceo_approved_terms",
  "salary_effective_date",
  "salary_change_applied_at",
  "salary_after_snapshot",
  "scheduled_termination",
  "employee_notified_of_termination_at",
  "employee_notified_of_termination_by",
  "termination_processed_at",
] as const;

function pick<K extends string>(raw: RawRating, keys: readonly K[]) {
  return Object.fromEntries(keys.map((key) => [key, raw[key]])) as Record<
    K,
    unknown
  >;
}

/**
 * Classifies one role-shaped payload. Returns null for `{}`, which the backend
 * sends to a viewer with no role on the rating. Order matters: the full
 * package also carries the response keys, so it is recognised first.
 */
export function toContractRatingView(
  raw: RawRating | null | undefined,
): ContractRatingView | null {
  if (!raw || typeof raw !== "object" || !("id" in raw)) return null;
  if ("workflow" in raw) {
    return { ...raw, viewer: "full" } as unknown as FullContractRating;
  }
  if ("employee_response" in raw) {
    return { ...raw, viewer: "employee" } as unknown as EmployeeContractRatingView;
  }
  if ("manager_response" in raw) {
    return { ...raw, viewer: "manager" } as unknown as ManagerContractRatingView;
  }
  if ("hr_comment_requested_at" in raw) {
    const header = { ...raw };
    for (const key of [...GATE_KEYS, ...OUTCOME_KEYS]) delete header[key];
    return {
      ...header,
      viewer: "hr_coarse",
      hr_comment_requested_at: null,
      gate: "account_connected" in raw ? pick(raw, GATE_KEYS) : null,
      outcome: raw.ceo_decision ? pick(raw, OUTCOME_KEYS) : null,
    } as unknown as HrCoarseContractRatingView;
  }
  return null;
}

/** A rated full package carries both evaluation panels. */
export function isRatedFullContractRating(
  view: FullContractRating,
): view is RatedFullContractRating {
  return view.rating_mode !== "SKIP_TO_CEO";
}

export interface RatingResponsePayload {
  criterion_ratings: CriterionRatings;
  overall_remark: string;
}

/**
 * Salary data is representable only on RENEW_WITH_CHANGES; the backend 422s
 * salary keys on any other value, so the type forbids them too.
 */
export type CeoDecisionPayload =
  | { ceo_decision: "RENEW" | "TERMINATE"; comment: string }
  | {
      ceo_decision: "RENEW_WITH_CHANGES";
      comment: string;
      /** Only changed components; the server re-derives `total_salary`. */
      ceo_approved_terms: ContractSalaryTerms;
      /** YYYY-MM-DD */
      salary_effective_date: string;
    }
  | { ceo_decision: CeoReturnAction; comment: string };

async function unwrapView(
  request: Promise<{ data: ApiResponse<RawRating> }>,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await request;
  if (isApiError(data)) return data;
  const view = toContractRatingView(data.data);
  if (!view) {
    return {
      status: "error",
      message: "This contract rating is not available to you.",
    };
  }
  return { ...data, data: view };
}

/**
 * A mutation can succeed and still leave the actor with no role on the
 * rating: after a CEO return the rating leaves PENDING_CEO, so the backend
 * answers `{}` (and a later GET 404s). That is reported as success with
 * `data: null`, never as an error.
 */
async function unwrapMutation(
  request: Promise<{ data: ApiResponse<RawRating> }>,
): Promise<ApiResponse<ContractRatingView | null>> {
  const { data } = await request;
  if (isApiError(data)) return data;
  return { ...data, data: toContractRatingView(data.data) };
}

export async function getRatingCriteria(): Promise<
  ApiResponse<RatingCriteriaPayload>
> {
  const { data } = await api.get<ApiResponse<RatingCriteriaPayload>>(
    `${BASE}/criteria/`,
  );
  return data;
}

export async function listContractRatings(
  params: {
    status?: ContractRatingStatus;
    page?: number;
    page_size?: number;
  } = {},
): Promise<ApiResponse<PaginatedResponse<ContractRatingView>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<RawRating>>>(
    `${BASE}/`,
    { params },
  );
  if (isApiError(data)) return data;
  const items = (data.data.items ?? [])
    .map(toContractRatingView)
    .filter((item): item is ContractRatingView => item !== null);
  return { ...data, data: { ...data.data, items } };
}

export function getContractRating(id: number | string) {
  return unwrapView(api.get<ApiResponse<RawRating>>(`${BASE}/${id}/`));
}

/**
 * HR receives 403 unless the CEO requested a comment on this rating;
 * managers and employees get their own side only.
 */
export async function downloadContractRatingPdf(
  id: number | string,
): Promise<Blob> {
  const response = await api.get(`${BASE}/${id}/pdf/`, {
    responseType: "blob",
  });
  return response.data;
}

export function submitRatingHrGate(id: number | string, rating_mode: RatingMode) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(`${BASE}/${id}/hr-gate/`, { rating_mode }),
  );
}

export function submitManagerRatingResponse(
  id: number | string,
  payload: RatingResponsePayload,
) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(`${BASE}/${id}/manager-response/`, payload),
  );
}

export function submitEmployeeRatingResponse(
  id: number | string,
  payload: RatingResponsePayload,
) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(
      `${BASE}/${id}/employee-response/`,
      payload,
    ),
  );
}

/** CEO only, PENDING_CEO only; idempotent. */
export function requestRatingHrComment(id: number | string) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(`${BASE}/${id}/request-hr-comment/`, {}),
  );
}

/** HR only; requires a prior CEO request on this rating. */
export function submitRatingHrComment(id: number | string, comment: string) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(`${BASE}/${id}/hr-comment/`, { comment }),
  );
}

export function submitRatingCeoDecision(
  id: number | string,
  payload: CeoDecisionPayload,
) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(`${BASE}/${id}/ceo-decision/`, payload),
  );
}

/** HR only, once the CEO has decided TERMINATE. */
export function acknowledgeRatingTerminationNotice(id: number | string) {
  return unwrapMutation(
    api.post<ApiResponse<RawRating>>(
      `${BASE}/${id}/acknowledge-termination-notice/`,
      {},
    ),
  );
}
