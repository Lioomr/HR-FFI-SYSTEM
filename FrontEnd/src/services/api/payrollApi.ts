import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * Payroll Run Status
 */
export type PayrollRunStatus = "DRAFT" | "COMPLETED" | "PAID" | "CANCELLED" | string;

/**
 * Payroll Run Data Transfer Object
 */
export interface PayrollRun {
  id: number;
  year: number;
  month: number;
  status: PayrollRunStatus;
  total_net: number;
  total_employees: number;
  created_at?: string;
  updated_at?: string;
  created_by?: number;
  // potentially other totals like total_basic, total_allowances etc. if needed in dashboard
}

/**
 * Payroll Run Item (Employee Scoped)
 */
export interface PayrollRunItem {
  id: number;
  payroll_run: number;
  employee_id: string | number;
  employee_name: string;
  department?: string;
  position?: string;

  // Financials
  basic_salary: number;

  // Aggregates
  total_allowances: number;
  total_deductions: number;
  net_salary: number; // The Calculated amount

  // We might generally just show the aggregates in the list, 
  // and have a full detail view if needed, but for "Review" this usually suffices.
}

export interface PayrollRunSummary {
  run_id: number;
  year: number;
  month: number;
  total_employees: number;
  employees_with_deductions: number;
  total_basic_salary: number;
  total_allowances: number;
  total_gross_salary: number;
  total_deductions: number;
  total_net_salary: number;
  average_net_salary: number;
}

/**
 * List Payroll Runs Query Params
 */
export interface ListPayrollRunsParams {
  page?: number;
  page_size?: number;
  year?: number;
}

/**
 * List Items Query Params
 */
export interface ListPayrollRunItemsParams {
  page?: number;
  page_size?: number;
  department?: string;
}

/**
 * Response wrappers
 */
export type PayrollRunListResponse = PaginatedResponse<PayrollRun>;
export type PayrollRunItemListResponse = PaginatedResponse<PayrollRunItem>;

// -- API Functions --

/**
 * Get list of payroll runs
 * GET /payroll-runs
 */
export async function getPayrollRuns(
  params?: ListPayrollRunsParams
): Promise<ApiResponse<PayrollRunListResponse>> {
  const { data } = await api.get<ApiResponse<PayrollRunListResponse>>(
    "/payroll-runs",
    { params }
  );
  return data;
}

/**
 * Get single payroll run details
 * GET /payroll-runs/{id}
 */
export async function getPayrollRunDetails(
  id: string | number
): Promise<ApiResponse<PayrollRun>> {
  const { data } = await api.get<ApiResponse<PayrollRun>>(`/payroll-runs/${id}`);
  return data;
}

/**
 * Create a new payroll run
 * POST /payroll-runs
 */
export interface CreatePayrollRunRequest {
  year: number;
  month: number;
}

export async function createPayrollRun(
  payload: CreatePayrollRunRequest
): Promise<ApiResponse<PayrollRun>> {
  const { data } = await api.post<ApiResponse<PayrollRun>>(
    "/payroll-runs",
    payload
  );
  return data;
}

/**
 * Get items (payslips/employees) for a payroll run
 * GET /payroll-runs/{id}/items
 */
export async function getPayrollRunItems(
  runId: string | number,
  params?: ListPayrollRunItemsParams
): Promise<ApiResponse<PayrollRunItemListResponse>> {
  const { data } = await api.get<ApiResponse<PayrollRunItemListResponse>>(
    `/payroll-runs/${runId}/items`,
    { params }
  );
  return data;
}


/**
 * Finalize a payroll run
 * POST /payroll-runs/{id}/finalize
 */
export async function finalizePayrollRun(
  runId: string | number
): Promise<ApiResponse<PayrollRun>> {
  const { data } = await api.post<ApiResponse<PayrollRun>>(
    `/payroll-runs/${runId}/finalize`,
    { confirm: true }
  );
  return data;
}

/**
 * Trigger payslip generation
 * POST /payroll-runs/{id}/generate-payslips
 */
export async function generatePayslips(
  runId: string | number
): Promise<ApiResponse<{ message: string; generated_count?: number; total_payslips?: number; run_status?: string }>> {
  const { data } = await api.post<ApiResponse<{ message: string; generated_count?: number; total_payslips?: number; run_status?: string }>>(
    `/payroll-runs/${runId}/generate-payslips`,
    {}
  );
  return data;
}

/**
 * Get payroll run summary
 * GET /payroll-runs/{id}/summary
 */
export async function getPayrollRunSummary(
  runId: string | number
): Promise<ApiResponse<PayrollRunSummary>> {
  const { data } = await api.get<ApiResponse<PayrollRunSummary>>(`/payroll-runs/${runId}/summary`);
  return data;
}

/**
 * Export payroll report
 * GET /payroll-runs/{id}/export?format=csv|pdf
 */
export async function exportPayrollReport(
  runId: string | number,
  format: "csv" | "pdf" | "xlsx"
): Promise<Blob> {
  const response = await api.get(
    `/payroll-runs/${runId}/export`,
    {
      params: { format },
      responseType: "blob"
    }
  );
  return response.data;
}
