import type {
  StartingWorkAcknowledgment,
  StartingWorkAcknowledgmentActions,
  StartingWorkWorkflow,
} from "../../../services/api/startingWorkAcknowledgmentsApi";

/** Every gate closed; each test opens only the ones its scenario is about. */
export const NO_ACTIONS: StartingWorkAcknowledgmentActions = {
  can_approve: false,
  can_reject: false,
  can_download: false,
};

export function makeActions(
  overrides: Partial<StartingWorkAcknowledgmentActions> = {},
): StartingWorkAcknowledgmentActions {
  return { ...NO_ACTIONS, ...overrides };
}

export function makeWorkflow(
  overrides: Partial<StartingWorkWorkflow> = {},
): StartingWorkWorkflow {
  return {
    status: "submitted",
    current_stage: "hr",
    current_actor: null,
    current_approver_role: "hr",
    can_approve: false,
    can_reject: false,
    can_download: false,
    history: [],
    ...overrides,
  };
}

/**
 * An acknowledgement waiting on HR.
 *
 * Tests override `actions` rather than the status, because every button in the
 * UI is gated on the backend can-* flags and not on the status text.
 */
export function makeAcknowledgment(
  overrides: Partial<StartingWorkAcknowledgment> = {},
): StartingWorkAcknowledgment {
  return {
    id: 7,
    reference_number: "FFI-064303-20260830",
    status: "pending_hr",
    status_label: "Pending HR Verification",
    employee: { id: 42, employee_id: "FFI-0643", name: "Nora Khalid" },
    company: { id: 1, code: "FFI", name: "Future Fence Industries" },
    first_biotime_attendance_date: "2026-08-24",
    generated_at: "2026-08-24T05:30:00Z",
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: "",
    document_available: true,
    document_download_url:
      "https://api.example.com/starting-work-acknowledgments/7/pdf/",
    affected_attendance_count: 3,
    actions: makeActions({
      can_approve: true,
      can_reject: true,
      can_download: true,
    }),
    workflow: makeWorkflow({ can_approve: true, can_reject: true }),
    ...overrides,
  };
}
