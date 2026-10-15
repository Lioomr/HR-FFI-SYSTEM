export interface WorkflowActor {
  id: number;
  email?: string | null;
  full_name?: string | null;
}

export interface WorkflowHistoryEntry {
  id?: number;
  action: string;
  stage?: string;
  approver_role?: string;
  actor?: WorkflowActor | null;
  at?: string | null;
  note?: string;
  from_status?: string;
  to_status?: string;
  from_stage?: string;
  to_stage?: string;
  metadata?: Record<string, unknown>;
}

export type CancellationRequestStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "withdrawn";

/** Employee request to HR to cancel an already approved request. */
export interface CancellationRequestSnapshot {
  id: number;
  status: CancellationRequestStatus;
  reason: string;
  requested_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string;
}

/** Server-driven cancellation-request flags carried on a request workflow. */
export interface CancellationWorkflowFlags {
  /** Server decides: approved request the employee may ask HR to cancel. */
  can_request_cancellation?: boolean;
  /** Server decides: a pending cancellation request the owner may withdraw. */
  can_withdraw_cancellation_request?: boolean;
  cancellation_request?: CancellationRequestSnapshot | null;
}

export interface WorkflowSnapshot extends CancellationWorkflowFlags {
  reference_no?: string | null;
  status:
    | "draft"
    | "submitted"
    | "in_review"
    | "approved"
    | "rejected"
    | "cancelled";
  current_stage?: string;
  current_actor?: WorkflowActor | null;
  current_approver_role?: string;
  can_approve?: boolean;
  can_reject?: boolean;
  can_cancel?: boolean;
  /** Server decides: true only while the owner may still edit (before HR). */
  can_edit?: boolean;
  history: WorkflowHistoryEntry[];
}
