import { getHttpStatus } from "../../../services/api/httpErrors";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

// Envelope messages returned by Backend/penalties/views.py and services.py.
const KNOWN_MESSAGES: Record<string, string> = {
  "a positive total salary is required. update salary data before issuing this monetary penalty.":
    "penalties.error.salaryRequired",
  "resolve the attendance or recurrence correction before payroll approval.":
    "penalties.error.correctionRequired",
  "only unapplied automatic correction reviews can be reopened.":
    "penalties.error.reopenUnavailable",
  "this penalty cannot be acknowledged.": "penalties.error.cannotAcknowledge",
  "this penalty cannot be disputed.": "penalties.error.cannotDispute",
  "this candidate has already been marked.": "penalties.error.alreadyMarked",
  "only disputed penalties can be resolved.":
    "penalties.error.onlyDisputedResolve",
  "only issued monetary penalties can be reviewed.":
    "penalties.error.onlyIssuedMonetaryReview",
  "this deduction is locked or unavailable.": "penalties.error.deductionLocked",
  "a reason is required.": "penalties.error.reasonRequired",
  "a note is required.": "penalties.error.noteRequired",
  "invalid hr marking.": "penalties.error.noteRequired",
  "invalid resolution.": "penalties.error.noteRequired",
  "invalid payroll review.": "penalties.error.noteRequired",
  "invalid hr marking for this catalog row.": "penalties.error.invalidMarking",
  "penalty date is outside the prospective period.":
    "penalties.error.dateOutOfRange",
  "invalid catalog code.": "penalties.error.invalidCatalog",
  "a single disciplinary fine cannot exceed five days' wages.":
    "penalties.error.fineCap",
  "invalid filters.": "penalties.error.invalidFilters",
  "not found.": "penalties.notFound",
};

function envelopeMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const err = error as
    | { apiData?: { message?: unknown }; response?: { data?: unknown } }
    | undefined;
  const data = (err?.apiData ?? err?.response?.data) as
    | { message?: unknown }
    | undefined;
  return typeof data?.message === "string" ? data.message : "";
}

/** 404/409: the record changed or disappeared, so the page must reload it. */
export function isStalePenaltyError(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 404 || status === 409;
}

/** Localized message for a penalty API failure (thrown error or envelope message). */
export function penaltyErrorMessage(t: TranslateFn, error: unknown): string {
  const message = envelopeMessage(error);
  const key = KNOWN_MESSAGES[message.trim().toLowerCase()];
  if (key) return t(key);
  if (getHttpStatus(error) === 404) return t("penalties.notFound");
  if (typeof error === "string")
    return error.trim() || t("common.error.genericDetailed");
  return getDetailedHttpErrorMessage(t, error);
}
