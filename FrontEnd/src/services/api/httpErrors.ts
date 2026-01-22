import type { AxiosError } from "axios";

/**
 * Extracts HTTP status code from various error formats
 * Handles Axios errors and objects with status property
 * 
 * @param err - Error of any type
 * @returns HTTP status code or undefined if not found
 */
export function getHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }

  const error = err as any;

  // Axios error format
  if (error.response?.status) {
    return error.response.status;
  }

  // Direct status property
  if (typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

/**
 * Type guard to check if error is a 401 Unauthorized
 * 
 * @example
 * catch (err) {
 *   if (isUnauthorized(err)) {
 *     // Redirect to login
 *   }
 * }
 */
export function isUnauthorized(err: unknown): boolean {
  return getHttpStatus(err) === 401;
}

/**
 * Type guard to check if error is a 403 Forbidden
 * Per Global API Rules, 403 means stay logged in but show unauthorized UI
 * 
 * @example
 * catch (err) {
 *   if (isForbidden(err)) {
 *     setForbidden(true); // Show unauthorized UI, don't logout
 *   }
 * }
 */
export function isForbidden(err: unknown): boolean {
  return getHttpStatus(err) === 403;
}

/**
 * Type guard to check if error is a 404 Not Found
 */
export function isNotFound(err: unknown): boolean {
  return getHttpStatus(err) === 404;
}

/**
 * Type guard to check if error is a 422 Unprocessable Entity (validation error)
 * 
 * @example
 * catch (err) {
 *   if (isValidationError(err)) {
 *     apply422ToForm(form, err);
 *   }
 * }
 */
export function isValidationError(err: unknown): boolean {
  return getHttpStatus(err) === 422;
}

/**
 * Type guard to check if error is a 500 Internal Server Error
 */
export function isServerError(err: unknown): boolean {
  const status = getHttpStatus(err);
  return status !== undefined && status >= 500 && status < 600;
}

/**
 * Type guard to check if error is an Axios error
 */
export function isAxiosError(err: unknown): err is AxiosError {
  return (
    err !== null &&
    typeof err === "object" &&
    "isAxiosError" in err &&
    err.isAxiosError === true
  );
}

/**
 * Extracts error message from various error formats
 */
export function getHttpErrorMessage(err: unknown): string {
  if (!err) {
    return "An unknown error occurred";
  }

  if (typeof err === "string") {
    return err;
  }

  if (err instanceof Error) {
    return err.message;
  }

  const error = err as any;

  // API error format
  if (error.response?.data?.message) {
    return error.response.data.message;
  }

  // Direct message property
  if (typeof error.message === "string") {
    return error.message;
  }

  return "An unexpected error occurred";
}
