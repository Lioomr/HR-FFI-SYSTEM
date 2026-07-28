export type ApiErrorCode =
  | 'authentication_failed'
  | 'invalid_response'
  | 'network_unavailable'
  | 'request_failed'
  | 'secure_storage_unavailable'
  | 'session_expired'
  | 'too_many_requests'
  | 'validation_failed';

const SAFE_MESSAGES: Readonly<Record<ApiErrorCode, string>> = Object.freeze({
  authentication_failed: 'Unable to authenticate.',
  invalid_response: 'The service returned an invalid response.',
  network_unavailable: 'The service is currently unavailable.',
  request_failed: 'The request could not be completed.',
  secure_storage_unavailable: 'Secure session storage is unavailable.',
  session_expired: 'Your session has expired. Please sign in again.',
  too_many_requests: 'Too many requests. Please try again later.',
  validation_failed: 'Some information was not accepted.',
});

/** A deliberately redacted error: it never retains URLs, payloads, headers, or tokens. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, status: number | null = null) {
    super(SAFE_MESSAGES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function safeApiError(status: number, authenticated: boolean): ApiError {
  if (status === 401) {
    return new ApiError(authenticated ? 'session_expired' : 'authentication_failed', status);
  }
  if (status === 422 || status === 400) {
    return new ApiError('validation_failed', status);
  }
  if (status === 429) {
    return new ApiError('too_many_requests', status);
  }
  if (status >= 500) {
    return new ApiError('network_unavailable', status);
  }
  return new ApiError('request_failed', status);
}
