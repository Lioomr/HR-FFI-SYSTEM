type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

export type ApprovalStatusTone = "pending" | "approved" | "rejected" | "neutral" | "inProgress";

/** Maps the raw backend status strings used across CEO queues onto a tone. */
export function toneForStatus(status?: string): ApprovalStatusTone {
  const value = (status || "").toUpperCase();
  if (!value) return "neutral";
  if (value.startsWith("PENDING")) return "pending";
  if (value === "REJECTED" || value === "CANCELLED") return "rejected";
  if (value === "APPROVED" || value === "EXECUTED" || value === "PROCESSED" || value === "PRESENT") {
    return "approved";
  }
  if (value === "SUBMITTED") return "inProgress";
  return "neutral";
}

/**
 * Backend status values reach the CEO screens in several casings
 * (`pending_ceo`, `PENDING_CEO`). Normalising here keeps every queue showing
 * the same translated wording for the same state.
 */
const STATUS_KEYS: Record<string, string> = {
  PENDING: "status.pending",
  PENDING_HR: "status.pendingHr",
  PENDING_MANAGER: "status.pendingManager",
  PENDING_MGR: "status.pendingManager",
  PENDING_CEO: "status.pendingCeo",
  PENDING_CFO: "status.pendingCfo",
  PENDING_FINANCE: "status.pendingFinance",
  PENDING_DISBURSEMENT: "status.pendingDisbursement",
  SUBMITTED: "status.submitted",
  APPROVED: "status.approved",
  REJECTED: "status.rejected",
  CANCELLED: "status.cancelled",
  DEDUCTED: "status.deducted",
  PROCESSED: "status.processed",
  PRESENT: "status.present",
  LATE: "status.late",
  ABSENT: "status.absent",
};

/** Title-cases an unmapped status so it never renders as raw snake_case. */
function humanize(status: string) {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function approvalStatusLabel(status: string | undefined, t: TranslateFn): string {
  if (!status) return "—";
  const key = STATUS_KEYS[status.toUpperCase()];
  return key ? t(key) : humanize(status);
}
