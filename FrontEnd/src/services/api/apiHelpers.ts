import type { ApiResponse, ApiError } from "./apiTypes";

/**
 * Type guard to check if an API response is an error
 * 
 * @example
 * const response = await someApi.getData();
 * if (isApiError(response)) {
 *   console.error(response.message);
 * } else {
 *   console.log(response.data);
 * }
 */
export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return res.status === "error";
}

/**
 * Unwraps API response data, throwing an error if the response indicates failure
 * 
 * @throws Error with the API error message if status is "error"
 * @example
 * try {
 *   const data = unwrapApiData(await someApi.getData());
 *   console.log(data);
 * } catch (error) {
 *   console.error(error.message);
 * }
 */
export function unwrapApiData<T>(res: ApiResponse<T>): T {
  if (isApiError(res)) {
    throw new Error(res.message || "API request failed");
  }
  return res.data;
}

/**
 * Safely extracts error message from various error formats
 * Handles Error objects, strings, and objects with message property
 * 
 * @param error - Error of any type
 * @returns Human-readable error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "An unexpected error occurred";
}
