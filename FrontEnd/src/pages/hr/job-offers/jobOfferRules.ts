import {
  CV_ACCEPT,
  MAX_CV_SIZE_BYTES,
  type JobOffer,
} from "../../../services/api/jobOffersApi";

/** The salary components the total package is built from, in display order. */
export const AMOUNT_FIELDS = [
  "basic_salary",
  "housing_allowance",
  "transportation_allowance",
  "other_allowance",
] as const;

export type AmountField = (typeof AMOUNT_FIELDS)[number];

/**
 * The package the candidate sees is always the sum of its parts, so the UI owns
 * the arithmetic and sends the result rather than leaving the two in disagreement.
 */
export function calculateTotalPackage(
  values: Partial<Record<AmountField, number | string | null>>,
): number {
  return AMOUNT_FIELDS.reduce((total, field) => {
    const raw = values[field];
    const parsed = typeof raw === "string" ? Number(raw) : raw;
    return total + (Number.isFinite(parsed) ? Number(parsed) : 0);
  }, 0);
}

/** The workflow flags an offer may or may not carry, all defaulting to "not allowed". */
type OfferWithWorkflow = Pick<JobOffer, "workflow">;

/**
 * Every action gate reads the backend's `workflow.can_*` snapshot rather than
 * re-deriving the rule from the status here.
 *
 * The server weighs company scope, role, workflow stage, the stored CV, the
 * expiry date and whether the signed-in user is the assigned approver. A local
 * copy of that reasoning would drift and would offer buttons the API refuses.
 * A response that predates a flag is read as "not allowed", which is the safe
 * direction: the action is hidden rather than offered and then rejected.
 */
function flag(
  offer: OfferWithWorkflow | null | undefined,
  key: keyof JobOffer["workflow"],
): boolean {
  return Boolean(offer?.workflow?.[key]);
}

/** HR may send only an approved offer, and only once. */
export function canSend(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_send");
}

/** HR may cancel while the offer is open and not under CEO review. */
export function canCancel(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_cancel");
}

/** HR edits drafts and returned offers; the CEO edits commercial terms under review. */
export function canEdit(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_edit");
}

/** Submit covers both the first send to the CEO and a resubmit after changes. */
export function canSubmit(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_submit");
}

export function canApprove(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_approve");
}

export function canRequestChanges(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_request_changes");
}

export function canReject(offer: OfferWithWorkflow): boolean {
  return flag(offer, "can_reject");
}

export type CvRejectionReason = "type" | "size";

/**
 * Mirrors the backend CV allow-list so a bad pick is refused before the file is
 * uploaded. The backend still re-checks extension, MIME and file signature;
 * this only spares the user a round trip.
 */
export function isAllowedCvFile(file: { name?: string; size?: number }): {
  ok: boolean;
  reason?: CvRejectionReason;
} {
  const name = (file.name || "").toLowerCase();
  const allowed = CV_ACCEPT.split(",").some((extension) =>
    name.endsWith(extension),
  );
  if (!allowed) return { ok: false, reason: "type" };
  if ((file.size || 0) > MAX_CV_SIZE_BYTES)
    return { ok: false, reason: "size" };
  return { ok: true };
}
