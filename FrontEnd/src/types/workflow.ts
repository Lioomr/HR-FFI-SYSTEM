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

export interface WorkflowSnapshot {
  status: "draft" | "submitted" | "in_review" | "approved" | "rejected" | "cancelled";
  current_stage?: string;
  current_actor?: WorkflowActor | null;
  current_approver_role?: string;
  can_approve?: boolean;
  can_reject?: boolean;
  can_cancel?: boolean;
  history: WorkflowHistoryEntry[];
}
