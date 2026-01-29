import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * Employee Payslip DTO
 */
export interface EmployeePayslip {
  id: number;
  payroll_run_id: number;
  month: number;
  year: number;
  
  // Financials - detailed breakdown
  basic_salary: number;
  
  // Allowances
  transportation_allowance?: number;
  accommodation_allowance?: number;
  telephone_allowance?: number;
  petrol_allowance?: number;
  other_allowance?: number;
  
  total_allowances: number;
  total_deductions: number;
  
  // Aggregates
  total_salary?: number; // basic + allowances
  net_salary: number;
  
  payment_mode?: string; // e.g. "Bank Transfer", "Cash"
  
  status: "generated" | "paid" | string;
  generated_at?: string;
}

export type PayslipListResponse = PaginatedResponse<EmployeePayslip>;

/**
 * Get My Payslips List
 * GET /employee/payslips
 */
export async function getMyPayslips(
  params?: { page?: number; page_size?: number; year?: number }
): Promise<ApiResponse<PayslipListResponse>> {
  const { data } = await api.get<ApiResponse<PayslipListResponse>>(
    "/employee/payslips",
    { params }
  );
  return data;
}

/**
 * Get My Payslip Details
 * GET /employee/payslips/{id}
 */
export async function getMyPayslip(
  id: string | number
): Promise<ApiResponse<EmployeePayslip>> {
  const { data } = await api.get<ApiResponse<EmployeePayslip>>(
    `/employee/payslips/${id}`
  );
  return data;
}

/**
 * Download My Payslip PDF
 * GET /employee/payslips/{id}/download
 */
export async function downloadMyPayslipPdf(
  id: string | number
): Promise<Blob> {
  const response = await api.get(
    `/employee/payslips/${id}/download`,
    { responseType: "blob" }
  );
  return response.data;
}
