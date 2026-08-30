import type {
  JobOffer,
  JobOfferWorkflow,
} from "../../../services/api/jobOffersApi";

/** Every gate closed; each test opens only the ones its scenario is about. */
export const NO_PERMISSIONS: JobOfferWorkflow = {
  status: "draft",
  current_stage: null,
  current_actor: null,
  current_approver_role: null,
  can_approve: false,
  can_reject: false,
  can_request_changes: false,
  can_cancel: false,
  can_edit: false,
  can_submit: false,
  can_send: false,
  history: [],
};

export function makeWorkflow(
  overrides: Partial<JobOfferWorkflow> = {},
): JobOfferWorkflow {
  return { ...NO_PERMISSIONS, ...overrides };
}

/**
 * A draft offer HR has written but not yet submitted.
 *
 * Tests override `workflow` rather than the statuses, because every action in
 * the UI is gated on the backend can-* flags and not on the status text.
 */
export function makeJobOffer(overrides: Partial<JobOffer> = {}): JobOffer {
  return {
    id: 11,
    company_id: 1,
    company_name: "FFI",
    employee_profile_id: null,
    account_invite_id: null,
    candidate_full_name: "Nora Khalid",
    candidate_email: "nora@example.com",
    candidate_phone_number: "+966501234567",
    nationality: "Saudi",
    date_of_birth: "1995-04-02",
    id_passport_iqama_number: "1234567890",
    has_cv: true,
    cv_download_url: "https://api.example.com/job-offers/11/cv/",
    department_id: 3,
    position_id: 5,
    position_title: "Site Engineer",
    classification: "Engineering",
    department: "Projects",
    location: "Riyadh",
    basic_salary: "10000.00",
    housing_allowance: "2500.00",
    transportation_allowance: "1000.00",
    other_allowance: "0.00",
    total_salary_package: "13500.00",
    vacation: "30 days",
    tickets: "Annual",
    contract_status: "New",
    contract_type: "Full time",
    contract_duration: "2 years",
    medical_insurance: "Class A",
    offer_date: "2026-08-01",
    expiry_date: "2026-08-20",
    reference_number: "JO-2026-011",
    hr_signer_user_id: 1,
    hr_signer_name: "HR Manager",
    hr_signer_title: "Head of HR",
    status: "draft",
    status_label: "Draft",
    approval_status: "draft",
    approval_status_label: "Draft",
    submitted_at: null,
    ceo_decision_by_id: null,
    ceo_decision_by_name: null,
    ceo_decision_at: null,
    ceo_decision_reason: "",
    ceo_recommendation: "",
    workflow: makeWorkflow({
      can_edit: true,
      can_submit: true,
      can_cancel: true,
    }),
    has_response_token: false,
    biotime: { is_mapped: false, biotime_emp_code: null, mapping_id: null },
    sent_at: null,
    accepted_at: null,
    rejected_at: null,
    cancelled_at: null,
    rejection_reason: "",
    delivery_metadata: null,
    created_at: "2026-08-01T08:00:00Z",
    updated_at: "2026-08-01T08:00:00Z",
    ...overrides,
  };
}
