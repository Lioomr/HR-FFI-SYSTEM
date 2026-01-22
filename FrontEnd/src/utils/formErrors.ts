import type { FormInstance } from "antd";
import type { ApiError } from "../services/api/apiTypes";

/**
 * Converts API error to Ant Design form field errors format
 * Per Global API Rules (v1), errors is contractually an array
 */
export function toAntdFieldErrors(
  apiError: ApiError
): { name: (string | number)[]; errors: string[] }[] {
  if (!apiError.errors || apiError.errors.length === 0) {
    // No field-specific errors, return form-level error
    return [{ name: ["_error"], errors: [apiError.message] }];
  }

  const fieldErrors: { name: (string | number)[]; errors: string[] }[] = [];

  // PRIMARY: Handle contract-compliant array format
  // errors: [{ field: "email", message: "Invalid" }, "General error"]
  if (Array.isArray(apiError.errors)) {
    apiError.errors.forEach((error) => {
      // Object format: { field?: string, message: string, code?: string }
      if (typeof error === "object" && error !== null && "message" in error) {
        const errorObj = error as { field?: string; message: string; code?: string };
        if (errorObj.field) {
          // Field-specific error
          fieldErrors.push({
            name: [errorObj.field],
            errors: [errorObj.message],
          });
        } else {
          // Form-level error (no field specified)
          fieldErrors.push({
            name: ["_error"],
            errors: [errorObj.message],
          });
        }
      }
      // String format: "General error message"
      else if (typeof error === "string") {
        fieldErrors.push({
          name: ["_error"],
          errors: [error],
        });
      }
    });
  }
  // LEGACY: Best-effort normalization for non-contract object format
  // { field: ["msg1", "msg2"] } - normalize to array shape internally
  else if (typeof apiError.errors === "object") {
    Object.entries(apiError.errors).forEach(([field, messages]) => {
      if (Array.isArray(messages)) {
        fieldErrors.push({
          name: [field],
          errors: messages,
        });
      } else if (typeof messages === "string") {
        fieldErrors.push({
          name: [field],
          errors: [messages],
        });
      }
    });
  }

  // Fallback: if no field errors were parsed, return form-level error
  if (fieldErrors.length === 0) {
    return [{ name: ["_error"], errors: [apiError.message] }];
  }

  return fieldErrors;
}

/**
 * Applies 422 validation errors to an Ant Design form
 * Safely handles various backend error formats
 * 
 * Per Global API Rules (v1), the contract format is array-based,
 * but this function also handles legacy object formats for backward compatibility.
 * 
 * @param form - Ant Design form instance
 * @param error - Error from API call (can be ApiError or Axios error)
 * 
 * @example
 * const handleSubmit = async (values) => {
 *   try {
 *     await someApi.createResource(values);
 *   } catch (err) {
 *     apply422ToForm(form, err); // Automatically maps field errors
 *     if (!isValidationError(err)) {
 *       message.error(getHttpErrorMessage(err));
 *     }
 *   }
 * };
 */
export function apply422ToForm(form: FormInstance, error: unknown): void {
  // Check if error is an ApiError with 422-like structure
  if (!error || typeof error !== "object") {
    return;
  }

  const apiError = error as any;

  // Check if it's an ApiError with status "error"
  if (apiError.status === "error" && apiError.errors) {
    const fieldErrors = toAntdFieldErrors(apiError as ApiError);
    form.setFields(fieldErrors);
    return;
  }

  // Check if it's an Axios error with 422 status
  if (apiError.response?.status === 422) {
    const responseData = apiError.response.data;
    
    // If response data is already an ApiError
    if (responseData?.status === "error") {
      const fieldErrors = toAntdFieldErrors(responseData as ApiError);
      form.setFields(fieldErrors);
      return;
    }

    // Handle direct errors object from backend
    if (responseData?.errors) {
      const fieldErrors = toAntdFieldErrors({
        status: "error",
        message: responseData.message || "Validation failed",
        errors: responseData.errors,
      });
      form.setFields(fieldErrors);
    }
  }
}

/**
 * Extracts validation errors from an API error for display
 * Converts array-based contract format to object format for easier consumption
 */
export function getValidationErrors(apiError: ApiError): Record<string, string[]> {
  if (!apiError.errors || apiError.errors.length === 0) {
    return {};
  }

  const result: Record<string, string[]> = {};

  // Convert array format to object format for display
  if (Array.isArray(apiError.errors)) {
    apiError.errors.forEach((error) => {
      if (typeof error === "object" && error !== null && "message" in error) {
        const errorObj = error as { field?: string; message: string };
        if (errorObj.field) {
          if (!result[errorObj.field]) {
            result[errorObj.field] = [];
          }
          result[errorObj.field].push(errorObj.message);
        }
      }
    });
  }
  // Legacy object format - pass through
  else if (typeof apiError.errors === "object") {
    return apiError.errors as Record<string, string[]>;
  }

  return result;
}
