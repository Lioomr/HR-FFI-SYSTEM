import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
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
 * That is intentional per plans/Employee Contract Rating Backend Handoff.md —
 * do not add an `/api` prefix to these paths.
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
  | "PENDING_RESPONSES"
  | "WAITING_MANAGER"
  | "WAITING_EMPLOYEE"
  | "PENDING_HR"
  | "PENDING_CEO"
  | "APPROVED"
  | "REJECTED"
  | "MANUAL_RESOLUTION_REQUIRED";

/** Statuses in which the backend accepts a manager/employee (re)submission. */
export const RESPONSE_STATUSES: ContractRatingStatus[] = [
  "PENDING_RESPONSES",
  "WAITING_MANAGER",
  "WAITING_EMPLOYEE",
];

export type RatingRecommendation =
  | "CONTINUE_CONTRACT"
  | "CONTINUE_WITH_CHANGES"
  | "TERMINATE";

export type RatingChangeType =
  | "SALARY_INCREASE"
  | "JOB_TITLE_CHANGE"
  | "POSITION_CHANGE"
  | "OTHER";

export type CeoRatingAction =
  | "ACCEPT"
  | "RETURN_TO_HR"
  | "DECLINE"
  | "DECLINE_WITH_ALTERNATIVE";

export type HrReviewAction =
  | "approve"
  | "return-manager"
  | "return-employee"
  | "return-both";

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

/** Fields shared by both raters' response rows. Averages are server-computed. */
export interface RatingResponseBase {
  id: number;
  rating: number;
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

/** Recommendation columns. Present on the manager's own row. */
export interface RatingRecommendationFields {
  recommendation: RatingRecommendation | "";
  recommended_change_types: RatingChangeType[];
  proposed_terms: ContractSalaryTerms;
  proposed_job_title: string;
  proposed_position_id: number | null;
  other_change_notes: string;
}

export type ManagerRatingResponse = RatingResponseBase &
  RatingRecommendationFields;

/** The backend strips every recommendation column from the employee's row. */
export type EmployeeRatingResponse = RatingResponseBase;

/**
 * What a manager receives. Only the header and their own response exist in
 * the payload — no employee response, comparison, comments or workflow.
 */
export interface ManagerContractRatingView extends ContractRatingHeader {
  manager_response: ManagerRatingResponse | null;
}

/**
 * What the rated employee receives. Only the header and their own response
 * exist in the payload — nothing about the manager, HR or CEO.
 */
export interface EmployeeContractRatingView extends ContractRatingHeader {
  employee_response: EmployeeRatingResponse | null;
}

export interface RatingComparisonRow {
  manager_grade: RatingGrade;
  manager_score: number;
  employee_grade: RatingGrade;
  employee_score: number;
  /** manager_score − employee_score */
  difference: number;
}

/**
 * Built when both responses are submitted; `{}` otherwise (including after an
 * HR return). Criterion codes map to rows; the four summary keys are strings.
 */
export type RatingComparisonSummary = {
  manager_average?: string;
  manager_overall_grade?: RatingGrade;
  employee_average?: string;
  employee_overall_grade?: RatingGrade;
} & Record<string, RatingComparisonRow | string | undefined>;

/** The full HR / CEO package. */
export interface FullContractRating extends ContractRatingHeader {
  contract_decision: number;
  employee_profile: number;
  manager_at_creation: number | null;
  department_snapshot: string;
  section_snapshot: string;
  job_title_snapshot: string;
  /** Full rows; the employee row carries empty recommendation columns. */
  manager_response: ManagerRatingResponse | null;
  employee_response: ManagerRatingResponse | null;
  comparison_summary: RatingComparisonSummary;
  hr_reviewed_by: number | null;
  hr_reviewed_by_name: string;
  hr_comment: string;
  hr_decided_at: string | null;
  ceo_action: CeoRatingAction | "";
  ceo_selected_option: ContractDecisionType | "";
  ceo_decided_by: number | null;
  ceo_decided_by_name: string;
  ceo_comment: string;
  ceo_decided_at: string | null;
  salary_change_proposed: boolean;
  salary_before_snapshot: ContractSalaryTerms;
  ceo_approved_terms: ContractSalaryTerms;
  ceo_salary_override_reason: string;
  salary_effective_date: string | null;
  salary_change_applied_at: string | null;
  salary_after_snapshot: ContractSalaryTerms;
  /** Decimal string; difference between the approved/proposed and base total. */
  salary_increase_amount: string;
  salary_increase_percent: string | null;
  scheduled_termination: boolean;
  employee_notified_of_termination_at: string | null;
  employee_notified_of_termination_by: number | null;
  termination_processed_at: string | null;
  notification_milestones: Record<string, unknown>;
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

/**
 * Any detail/list item. A viewer with no role on the rating gets `{}`.
 * Narrow with the guards below before touching role-specific keys.
 */
export type ContractRatingView =
  | FullContractRating
  | ManagerContractRatingView
  | EmployeeContractRatingView;

/**
 * The full package is identified by keys only it carries. A privileged user
 * who is also this employee's manager receives the manager shape instead.
 */
export function isFullContractRating(
  view: ContractRatingView | Record<string, never>,
): view is FullContractRating {
  return "workflow" in view && "comparison_summary" in view;
}

export function isManagerRatingView(
  view: ContractRatingView | Record<string, never>,
): view is ManagerContractRatingView {
  return (
    "id" in view && "manager_response" in view && !isFullContractRating(view)
  );
}

export function isEmployeeRatingView(
  view: ContractRatingView | Record<string, never>,
): view is EmployeeContractRatingView {
  return (
    "id" in view && "employee_response" in view && !isFullContractRating(view)
  );
}

export interface ManagerResponsePayload {
  criterion_ratings: CriterionRatings;
  overall_remark: string;
  recommendation: RatingRecommendation;
  /** Only with CONTINUE_WITH_CHANGES. */
  recommended_change_types?: RatingChangeType[];
  /** Only with SALARY_INCREASE; omitted components keep the current value. */
  proposed_terms?: ContractSalaryTerms;
  /** Only with JOB_TITLE_CHANGE. */
  proposed_job_title?: string;
  /** Only with POSITION_CHANGE. */
  proposed_position_id?: number;
  /** Only with OTHER. */
  other_change_notes?: string;
  /** Only with SALARY_INCREASE; backend defaults to the day after expiry. */
  salary_effective_date?: string;
}

/**
 * The employee payload deliberately has no other keys: the backend rejects the
 * request if any manager field is present, even an empty one.
 */
export interface EmployeeResponsePayload {
  criterion_ratings: CriterionRatings;
  overall_remark?: string;
}

export interface HrReviewPayload {
  action: HrReviewAction;
  /** Required for every return action. */
  comment?: string;
}

export interface CeoDecisionPayload {
  action: CeoRatingAction;
  /** Required for everything except ACCEPT. */
  comment?: string;
  /** Required only (and allowed only) for DECLINE_WITH_ALTERNATIVE. */
  ceo_selected_option?: ContractDecisionType;
  /** Only for DECLINE_WITH_ALTERNATIVE + RENEW_WITH_CHANGES. */
  ceo_approved_terms?: ContractSalaryTerms;
  /** Required when `ceo_approved_terms` differ from the manager's proposal. */
  ceo_salary_override_reason?: string;
}

export interface RatingPositionOption {
  id: number;
  name: string;
}

export async function listRatingPositions(
  id: number | string,
): Promise<ApiResponse<RatingPositionOption[]>> {
  const { data } = await api.get<ApiResponse<RatingPositionOption[]>>(
    `${BASE}/${id}/positions/`,
  );
  return data;
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
  const { data } = await api.get<
    ApiResponse<PaginatedResponse<ContractRatingView>>
  >(`${BASE}/`, { params });
  return data;
}

export async function getContractRating(
  id: number | string,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await api.get<ApiResponse<ContractRatingView>>(
    `${BASE}/${id}/`,
  );
  return data;
}

export async function downloadContractRatingPdf(
  id: number | string,
): Promise<Blob> {
  const response = await api.get(`${BASE}/${id}/pdf/`, {
    responseType: "blob",
  });
  return response.data;
}

export async function submitManagerRatingResponse(
  id: number | string,
  payload: ManagerResponsePayload,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await api.post<ApiResponse<ContractRatingView>>(
    `${BASE}/${id}/manager-response/`,
    payload,
  );
  return data;
}

export async function submitEmployeeRatingResponse(
  id: number | string,
  payload: EmployeeResponsePayload,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await api.post<ApiResponse<ContractRatingView>>(
    `${BASE}/${id}/employee-response/`,
    payload,
  );
  return data;
}

export async function submitRatingHrReview(
  id: number | string,
  payload: HrReviewPayload,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await api.post<ApiResponse<ContractRatingView>>(
    `${BASE}/${id}/hr-review/`,
    payload,
  );
  return data;
}

export async function submitRatingCeoDecision(
  id: number | string,
  payload: CeoDecisionPayload,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await api.post<ApiResponse<ContractRatingView>>(
    `${BASE}/${id}/ceo-decision/`,
    payload,
  );
  return data;
}

export async function acknowledgeRatingTerminationNotice(
  id: number | string,
): Promise<ApiResponse<ContractRatingView>> {
  const { data } = await api.post<ApiResponse<ContractRatingView>>(
    `${BASE}/${id}/acknowledge-termination-notice/`,
    {},
  );
  return data;
}
