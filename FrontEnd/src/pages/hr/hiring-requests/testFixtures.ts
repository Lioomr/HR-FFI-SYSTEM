import type {
  HiringRequest,
  HiringRequestStatus,
  HiringRequestWorkflow,
} from "../../../services/api/hiringRequestsApi";

/**
 * Shared fixture for the hiring-request screens.
 *
 * The workflow flags default to what the backend returns for an HR user looking
 * at their own draft, because that is the state most screens start from; each
 * test overrides only the part it is about.
 */
export function makeWorkflow(overrides: Partial<HiringRequestWorkflow> = {}): HiringRequestWorkflow {
  return {
    status: "draft",
    current_stage: null,
    current_actor: null,
    current_approver_role: null,
    can_approve: false,
    can_reject: false,
    can_cancel: true,
    can_edit: true,
    can_submit: true,
    history: [],
    ...overrides,
  };
}

export function makeHiringRequest(overrides: Partial<HiringRequest> = {}): HiringRequest {
  const status = (overrides.status || "draft") as HiringRequestStatus;
  return {
    id: 1,
    company_id: 1,
    company_name: "FFI",
    reference_number: "HR-2026-001",
    candidate_full_name: "Nora Khalid",
    candidate_email: "nora@example.com",
    candidate_phone_number: "+966501234567",
    nationality: "Saudi Arabia",
    date_of_birth: "1995-04-12",
    proposed_salary: "12000.00",
    has_cv: true,
    cv_download_url: "http://backend/hiring-requests/1/cv/",
    status,
    status_label: status.charAt(0).toUpperCase() + status.slice(1),
    requested_by_id: 5,
    requested_by_name: "HR Manager",
    submitted_at: null,
    ceo_decision_by_id: null,
    ceo_decision_by_name: null,
    ceo_decision_at: null,
    ceo_decision_note: "",
    job_offer_id: null,
    workflow: makeWorkflow(),
    created_at: "2026-08-01T08:00:00Z",
    updated_at: "2026-08-01T08:00:00Z",
    ...overrides,
  };
}

export const okList = (items: unknown[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 25, count: items.length, total_pages: 1 },
});

export const ok = <T,>(data: T) => ({ status: "success" as const, data });
