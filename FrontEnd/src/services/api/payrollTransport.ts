import { api } from "./apiClient";

/**
 * Single entry point for every payroll HTTP call, so the whole payroll surface
 * can run against the contract mocks (services/api/payrollMocks) before the
 * backend ships, and switch to the live API with one flag.
 *
 * - Live (default): axios `api` instance (JWT, X-Active-Company-Id and
 *   Accept-Language are injected by apiClient's interceptor).
 * - Mocks: set VITE_PAYROLL_MOCKS=1 for local dev, or call
 *   setPayrollMocksEnabled(true) in a test. The mock handler is loaded with a
 *   dynamic import, so it never lands in the initial bundle.
 *
 * Mock errors are thrown in the same shape as an axios error
 * (`response.status`, `response.data`, `apiData`), so pages handle both alike.
 */

export type PayrollHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface PayrollRequest {
  method: PayrollHttpMethod;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  responseType?: "json" | "blob";
}

let mockOverride: boolean | undefined;

/** Test/dev hook: force mocks on or off; `undefined` returns to the env flag. */
export function setPayrollMocksEnabled(enabled: boolean | undefined): void {
  mockOverride = enabled;
}

export function payrollMocksEnabled(): boolean {
  if (mockOverride !== undefined) return mockOverride;
  return import.meta.env.VITE_PAYROLL_MOCKS === "1";
}

/**
 * True when the payroll rebuild screens may call the new contract endpoints:
 * with mocks on, or once VITE_PAYROLL_REBUILD=1 is set after the backend's
 * Phase 2 handoff. Entry points embedded in existing pages (nav links, the
 * employee GOSI control) stay hidden otherwise, so the live app never calls a
 * route that does not exist yet.
 */
export function payrollRebuildEnabled(): boolean {
  return payrollMocksEnabled() || import.meta.env.VITE_PAYROLL_REBUILD === "1";
}

/** Drops undefined/empty-string query values so URLs only carry real filters. */
function cleanParams(params?: Record<string, unknown>) {
  if (!params) return undefined;
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export async function payrollRequest<T>(request: PayrollRequest): Promise<T> {
  const params = cleanParams(request.params);
  if (payrollMocksEnabled()) {
    const { handlePayrollMockRequest } = await import("./payrollMocks/handler");
    return handlePayrollMockRequest({ ...request, params }) as Promise<T>;
  }
  const response = await api.request<T>({
    method: request.method,
    url: request.url,
    params,
    // GET requests have no body (contract section 4.2).
    data: request.method === "GET" ? undefined : request.data,
    responseType: request.responseType ?? "json",
  });
  return response.data;
}

/** Success envelope `{status:"success", data}` as returned by every JSON endpoint. */
export interface PayrollEnvelope<T> {
  status: "success";
  data: T;
}

/** Calls a JSON endpoint and returns its `data`. Errors are thrown, never returned. */
export async function payrollData<T>(request: PayrollRequest): Promise<T> {
  const envelope = await payrollRequest<
    PayrollEnvelope<T> | { status: "error" }
  >(request);
  if (envelope.status !== "success") {
    // A 2xx error envelope is still an error: surface it like an HTTP one.
    throw { response: { status: 200, data: envelope }, apiData: envelope };
  }
  return envelope.data;
}
