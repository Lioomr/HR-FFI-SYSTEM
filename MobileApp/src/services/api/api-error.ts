export type ApiErrorCode =
  | 'authentication_failed'
  | 'forbidden'
  | 'invalid_response'
  | 'network_unavailable'
  | 'not_found'
  | 'outside_work_location'
  | 'request_failed'
  | 'secure_storage_unavailable'
  | 'session_expired'
  | 'too_many_requests'
  | 'validation_failed';

const SAFE_MESSAGES: Readonly<Record<ApiErrorCode, string>> = Object.freeze({
  authentication_failed: 'Unable to authenticate.',
  forbidden: 'You do not have access to this information.',
  invalid_response: 'The service returned an invalid response.',
  network_unavailable: 'The service is currently unavailable.',
  not_found: 'The requested information is not available.',
  outside_work_location: 'You are not at an approved work location.',
  request_failed: 'The request could not be completed.',
  secure_storage_unavailable: 'Secure session storage is unavailable.',
  session_expired: 'Your session has expired. Please sign in again.',
  too_many_requests: 'Too many requests. Please try again later.',
  validation_failed: 'Some information was not accepted.',
});

/** Server validation text is only ever surfaced for these deliberately narrow statuses. */
const VALIDATION_STATUSES = Object.freeze([400, 422]);
const MAX_VALIDATION_DETAILS = 5;
const MAX_VALIDATION_DETAIL_LENGTH = 200;
/** Anything that could carry a credential, URL, or stack frame is dropped, never rendered. */
const UNSAFE_DETAIL_PATTERN =
  /bearer\s|authorization|[a-z0-9_-]{16,}\.[a-z0-9_-]{16,}\.[a-z0-9_-]{16,}|https?:\/\/|\/[a-z0-9_.-]+\/[a-z0-9_.-]+\.(?:py|ts|tsx|js)|traceback|<[^>]+>/iu;

function safeDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim();
  if (!normalized || UNSAFE_DETAIL_PATTERN.test(normalized)) return null;
  return normalized.slice(0, MAX_VALIDATION_DETAIL_LENGTH);
}

/**
 * Normalizes the documented `{status:"error", message, errors:[...]}` envelope into a
 * bounded list of display-safe validation strings. Non-validation statuses return none.
 */
export function safeValidationDetails(status: number, payload: unknown): string[] {
  if (!VALIDATION_STATUSES.includes(status)) return [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const envelope = payload as { errors?: unknown; message?: unknown };
  const raw = Array.isArray(envelope.errors) ? envelope.errors : [];
  const details = raw
    .map((entry) => {
      if (typeof entry === 'string') return safeDetail(entry);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return safeDetail((entry as { message?: unknown }).message);
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (details.length === 0) {
    const message = safeDetail(envelope.message);
    return message ? [message] : [];
  }
  return [...new Set(details)].slice(0, MAX_VALIDATION_DETAILS);
}

/**
 * The single 403 body the client is allowed to recognise, quoted verbatim from the
 * "Mobile self-service GPS contract" failure table in
 * `plans/Geofenced Attendance Phase 8 Backend Contract.md`.
 *
 * It is a closed-set sentinel used only for classification. It is compared with `===`,
 * never rendered, and never stored on the error, so the outside-site UI state cannot be
 * driven by arbitrary server text or by a message the contract does not define.
 */
export const OUTSIDE_WORK_LOCATION_MESSAGE = 'You are not within an approved work location.';

/**
 * Recognises that one message on a 403 and nothing else. Every other forbidden response,
 * including the archived-profile and active-company rejections that share the status,
 * stays fully redacted as a generic `forbidden`.
 */
export function isOutsideWorkLocationEnvelope(status: number, payload: unknown): boolean {
  if (status !== 403) return false;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const envelope = payload as { message?: unknown; status?: unknown };
  return envelope.status === 'error' && envelope.message === OUTSIDE_WORK_LOCATION_MESSAGE;
}

/**
 * A deliberately redacted error: it never retains URLs, payloads, headers, or tokens.
 * `details` is populated only from server validation envelopes on 400/422 and is
 * sanitized before it is stored.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly details: readonly string[];

  constructor(code: ApiErrorCode, status: number | null = null, details: readonly string[] = []) {
    super(SAFE_MESSAGES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = Object.freeze(
      code === 'validation_failed'
        ? details
            .map((detail) => safeDetail(detail))
            .filter((detail): detail is string => Boolean(detail))
            .slice(0, MAX_VALIDATION_DETAILS)
        : [],
    );
  }
}

export function safeApiError(
  status: number,
  authenticated: boolean,
  details: readonly string[] = [],
  outsideWorkLocation = false,
): ApiError {
  if (status === 401) {
    return new ApiError(authenticated ? 'session_expired' : 'authentication_failed', status);
  }
  if (status === 403) {
    return new ApiError(outsideWorkLocation ? 'outside_work_location' : 'forbidden', status);
  }
  if (status === 404) {
    return new ApiError('not_found', status);
  }
  if (status === 422 || status === 400) {
    return new ApiError('validation_failed', status, details);
  }
  if (status === 429) {
    return new ApiError('too_many_requests', status);
  }
  if (status >= 500) {
    return new ApiError('network_unavailable', status);
  }
  return new ApiError('request_failed', status);
}
