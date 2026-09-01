import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * HR BioTime verification of an employee's first attendance day.
 *
 * The acknowledgement is an HR-only record: it is never delivered to the
 * employee and is deliberately absent from the employee document APIs, so the
 * only way to reach its PDF is `document_download_url` on this resource.
 */
export type StartingWorkAcknowledgmentStatus =
  | "pending_hr"
  | "approved"
  | "rejected";

/** Reviewer identity recorded on an approval or a rejection. */
export type StartingWorkReviewer = {
  id: number;
  name: string;
  email: string;
};

export type StartingWorkEmployee = {
  id: number;
  employee_id: string;
  name: string;
};

export type StartingWorkCompany = {
  id: number;
  code: string;
  name: string;
};

/**
 * Actor on a workflow snapshot or one of its history entries.
 *
 * The workflow engine reports an object; the published contract described a
 * plain `actor_name`. Both are accepted so neither shape renders as blank.
 */
export type StartingWorkWorkflowActor = {
  id?: number | null;
  email?: string | null;
  full_name?: string | null;
};

/**
 * One recorded workflow step.
 *
 * `at` is what the workflow engine emits and `timestamp` is the name in the
 * published contract; the same applies to `actor` versus `actor_name`. Read
 * them through `historyEntryTimestamp` / `historyEntryActorName` rather than
 * picking a field directly.
 */
export type StartingWorkWorkflowHistoryEntry = {
  id?: number | null;
  action: string;
  stage?: string | null;
  approver_role?: string | null;
  actor?: StartingWorkWorkflowActor | null;
  actor_name?: string | null;
  at?: string | null;
  timestamp?: string | null;
  note?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  from_stage?: string | null;
  to_stage?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type StartingWorkWorkflow = {
  status: string;
  current_stage: string | null;
  current_actor: StartingWorkWorkflowActor | string | null;
  current_approver_role: string | null;
  can_approve: boolean;
  can_reject: boolean;
  can_download?: boolean;
  history: StartingWorkWorkflowHistoryEntry[];
};

/**
 * Server-computed permissions for the signed-in HR user.
 *
 * These flags are the only authority on which buttons appear. Deriving them
 * from the status instead would drift from the backend, which also weighs the
 * role, the company scope and whether the PDF is actually on disk — and which
 * allows approving an already-rejected acknowledgement after a correction.
 */
export type StartingWorkAcknowledgmentActions = {
  can_approve: boolean;
  can_reject: boolean;
  can_download: boolean;
};

export type StartingWorkAcknowledgment = {
  id: number;
  reference_number: string;
  status: StartingWorkAcknowledgmentStatus;
  status_label: string;
  employee: StartingWorkEmployee;
  company: StartingWorkCompany;
  first_biotime_attendance_date: string;
  generated_at: string;
  approved_by: StartingWorkReviewer | null;
  approved_at: string | null;
  rejected_by: StartingWorkReviewer | null;
  rejected_at: string | null;
  rejection_reason: string;
  document_available: boolean;
  document_download_url: string | null;
  /** Attendance rows held back from payroll until this verification is approved. */
  affected_attendance_count: number;
  actions: StartingWorkAcknowledgmentActions;
  workflow: StartingWorkWorkflow;
};

export type StartingWorkAcknowledgmentListResponse =
  PaginatedResponse<StartingWorkAcknowledgment>;

export type StartingWorkAcknowledgmentListParams = {
  status?: StartingWorkAcknowledgmentStatus;
  page?: number;
  page_size?: number;
};

/** Rejection body; the backend refuses a blank reason with a 422. */
export type StartingWorkRejectionPayload = {
  reason: string;
};

const LIST_PATH = "/starting-work-acknowledgments/";

/** Reads the timestamp under whichever of the two contract names is present. */
export function historyEntryTimestamp(
  entry: StartingWorkWorkflowHistoryEntry,
): string | null {
  return entry.at || entry.timestamp || null;
}

/** Reads the actor name from either the actor object or the flat field. */
export function historyEntryActorName(
  entry: StartingWorkWorkflowHistoryEntry,
): string {
  if (entry.actor_name) return entry.actor_name.trim();
  const actor = entry.actor;
  if (!actor) return "";
  return (actor.full_name || actor.email || "").trim();
}

/** Same tolerance for the snapshot's current actor. */
export function workflowActorName(
  actor: StartingWorkWorkflowActor | string | null | undefined,
): string {
  if (!actor) return "";
  if (typeof actor === "string") return actor.trim();
  return (actor.full_name || actor.email || "").trim();
}

export async function listStartingWorkAcknowledgments(
  params: StartingWorkAcknowledgmentListParams = {},
) {
  const { data } = await api.get<
    ApiResponse<StartingWorkAcknowledgmentListResponse>
  >(LIST_PATH, { params });
  return data;
}

export async function getStartingWorkAcknowledgment(id: number | string) {
  const { data } = await api.get<ApiResponse<StartingWorkAcknowledgment>>(
    `${LIST_PATH}${id}/`,
  );
  return data;
}

export async function approveStartingWorkAcknowledgment(id: number | string) {
  const { data } = await api.post<ApiResponse<StartingWorkAcknowledgment>>(
    `${LIST_PATH}${id}/approve/`,
    {},
  );
  return data;
}

export async function rejectStartingWorkAcknowledgment(
  id: number | string,
  payload: StartingWorkRejectionPayload,
) {
  const { data } = await api.post<ApiResponse<StartingWorkAcknowledgment>>(
    `${LIST_PATH}${id}/reject/`,
    { reason: payload.reason },
  );
  return data;
}

/**
 * Turns `document_download_url` into a same-origin path.
 *
 * The backend builds that URL absolute to its own host, which the browser only
 * reaches through this app's proxy and without the bearer token — so the path
 * is what gets requested, never the absolute URL.
 */
export function resolveAcknowledgmentDocumentPath(
  acknowledgment: Pick<StartingWorkAcknowledgment, "document_download_url">,
): string | null {
  const url = acknowledgment.document_download_url;
  if (!url) return null;
  if (url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Fetches the acknowledgement PDF as a blob.
 *
 * `document_download_url` is the only supported source: HR-only
 * acknowledgements are intentionally missing from the employee document APIs,
 * so there is no `/employees/{id}/documents/...` fallback to reach for.
 */
export async function downloadStartingWorkAcknowledgmentPdf(
  acknowledgment: Pick<StartingWorkAcknowledgment, "document_download_url">,
): Promise<Blob> {
  const path = resolveAcknowledgmentDocumentPath(acknowledgment);
  if (!path) {
    throw new Error("This acknowledgement has no stored document.");
  }
  const response = await api.get(path, { responseType: "blob" });
  return response.data;
}

/** Filename for the saved PDF; the reference number is what HR files it under. */
export function acknowledgmentPdfFilename(
  acknowledgment: Pick<StartingWorkAcknowledgment, "id" | "reference_number">,
): string {
  const reference = (acknowledgment.reference_number || "").trim();
  const suffix = reference
    ? reference.replace(/[^\w.-]+/g, "_")
    : String(acknowledgment.id);
  return `starting_work_acknowledgment_${suffix}.pdf`;
}
