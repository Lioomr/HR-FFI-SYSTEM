import { toAntdNamePath } from "../../utils/formErrors";
import type { PayrollErrorItem } from "./payrollTypes";

/**
 * One parser for every payroll error shape (contract section 4.2):
 * - object items `{field, code, message, message_key, params}` (new endpoints),
 * - legacy string arrays (`errors: ["Payroll run already exists ..."]`),
 * - framework errors with only `message`/`detail`.
 *
 * Messages are shown exactly as the API sent them: the backend already
 * localises them from Accept-Language. The frontend never rewrites a message
 * from its code, except to fall back when the API sent no text at all.
 */
export interface ParsedPayrollError {
  httpStatus?: number;
  /** Envelope-level message (or detail) from the API, if any. */
  message?: string;
  /** Every error item, strings normalised to `{message}`. */
  items: PayrollErrorItem[];
  /** Items with a `field`, as Ant Design `setFields` entries. */
  fieldErrors: { name: (string | number)[]; errors: string[] }[];
  /** Messages without a field (record-level), in order. */
  formMessages: string[];
  /** 409 stale_revision: the caller must stop, reload and let the user retry. */
  isStaleRevision: boolean;
  codes: string[];
}

function responseData(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object") return undefined;
  const anyError = error as {
    response?: { data?: unknown };
    apiData?: unknown;
    status?: unknown;
  };
  const candidates = [anyError.response?.data, anyError.apiData];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      !(candidate instanceof Blob)
    ) {
      return candidate as Record<string, unknown>;
    }
  }
  if (anyError.status === "error") return anyError as Record<string, unknown>;
  return undefined;
}

function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { response?: { status?: unknown } }).response
    ?.status;
  return typeof status === "number" ? status : undefined;
}

function normaliseItem(item: unknown): PayrollErrorItem | null {
  if (typeof item === "string") {
    return item.trim() ? { message: item.trim() } : null;
  }
  if (item && typeof item === "object") {
    const candidate = item as PayrollErrorItem;
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate;
    }
    if (typeof candidate.code === "string") {
      return { ...candidate, message: "" };
    }
  }
  return null;
}

/**
 * @param fieldMap optional server-field -> form-field rename (for example when
 *   a form keeps rates as percentages under a different name).
 */
export function parsePayrollError(
  error: unknown,
  fieldMap: Record<string, string> = {},
): ParsedPayrollError {
  const data = responseData(error);
  const rawErrors = Array.isArray(data?.errors) ? data.errors : [];
  const items = rawErrors
    .map(normaliseItem)
    .filter((item): item is PayrollErrorItem => item !== null);

  const message =
    typeof data?.message === "string" && data.message.trim()
      ? data.message
      : typeof data?.detail === "string" && data.detail.trim()
        ? data.detail
        : undefined;

  const fieldErrors: ParsedPayrollError["fieldErrors"] = [];
  const formMessages: string[] = [];
  for (const item of items) {
    const text = item.message || message || "";
    if (item.field) {
      const formField = fieldMap[item.field] ?? item.field;
      const existing = fieldErrors.find(
        (entry) => entry.name.join(".") === formField,
      );
      if (existing) existing.errors.push(text);
      else
        fieldErrors.push({ name: toAntdNamePath(formField), errors: [text] });
    } else if (text) {
      formMessages.push(text);
    }
  }

  const httpStatus = httpStatusOf(error);
  const codes = items
    .map((item) => item.code)
    .filter((code): code is string => typeof code === "string");

  return {
    httpStatus,
    message,
    items,
    fieldErrors,
    formMessages,
    isStaleRevision: httpStatus === 409 && codes.includes("stale_revision"),
    codes,
  };
}

/**
 * Best single line to show for an error: the first record-level message, then
 * the envelope message, then the first field message, then the fallback.
 */
export function payrollErrorSummary(
  parsed: ParsedPayrollError,
  fallback: string,
): string {
  return (
    parsed.formMessages[0] ||
    parsed.message ||
    parsed.fieldErrors[0]?.errors[0] ||
    fallback
  );
}
