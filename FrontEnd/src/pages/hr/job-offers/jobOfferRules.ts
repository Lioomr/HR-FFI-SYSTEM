import type { JobOffer } from "../../../services/api/jobOffersApi";

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

/** Sending is one-shot so repeated or concurrent clicks cannot duplicate delivery. */
export function canSend(offer: Pick<JobOffer, "status">): boolean {
  return offer.status === "draft";
}

/** The backend only accepts cancellation while the offer is still open. */
export function canCancel(offer: Pick<JobOffer, "status">): boolean {
  return offer.status === "draft" || offer.status === "sent";
}

/** Only drafts are editable — the backend rejects a PATCH once an offer is sent. */
export function canEdit(offer: Pick<JobOffer, "status">): boolean {
  return offer.status === "draft";
}
