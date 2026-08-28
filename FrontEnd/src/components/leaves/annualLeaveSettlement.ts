import {
  toDecimalNumber,
  type AnnualLeavePaymentRequest,
  type AnnualLeavePaymentStatus,
} from "../../services/api/annualLeavePaymentsApi";

/**
 * Non-visual helpers shared by the employee, HR and CEO settlement screens.
 *
 * They only read what the backend already sent — no figure is recomputed here.
 */

/** Statuses that block a new request for the same contract cycle. */
export const ACTIVE_ANNUAL_PAYMENT_STATUSES: AnnualLeavePaymentStatus[] = [
  "pending_hr",
  "pending_ceo",
  "approved",
  "carried_forward",
];

export function isActiveAnnualPayment(
  request?: AnnualLeavePaymentRequest | null,
): boolean {
  return Boolean(
    request && ACTIVE_ANNUAL_PAYMENT_STATUSES.includes(request.status),
  );
}

/** Formats a day count without inventing precision the backend did not send. */
export function formatSettlementDays(
  value: string | number | null | undefined,
): string {
  const numeric = toDecimalNumber(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

/** Two-decimal money, matching the backend `DecimalField(decimal_places=2)`. */
export function formatSettlementAmount(
  value: string | number | null | undefined,
): string {
  return toDecimalNumber(value).toFixed(2);
}
