import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Employee data type
 */
export interface Employee {
  id: number;
  employee_id: string;
  user_id: number;
  full_name: string;
  email: string;
  mobile?: string;
  passport?: string;
  department?: string;
  job_title?: string;
  position?: string;
  task_group?: string;
  sponsor?: string;
  employment_status?: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  hire_date?: string;
  department_id?: number;
  position_id?: number;
  task_group_id?: number;
  sponsor_id?: number;
  manager_id?: number;
  manager_name?: string;
  nationality?: string;
  employee_number?: string;
  passport_no?: string;
  passport_expiry?: string;
  national_id?: string;
  id_expiry?: string;
  date_of_birth?: string;
  job_offer?: string;
  contract_date?: string;
  contract_expiry?: string;
  allowed_overtime?: number;
  health_card?: string;
  health_card_expiry?: string;
  basic_salary?: number;
  transportation_allowance?: number;
  accommodation_allowance?: number;
  telephone_allowance?: number;
  petrol_allowance?: number;
  other_allowance?: number;
  total_salary?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * List employees query parameters
 */
export interface ListEmployeesParams {
  page?: number;
  page_size?: number;
  search?: string;
  department?: string;
  position?: string;
  task_group?: string;
  sponsor?: string;
  status?: string;
}

/**
 * Paginated employee list response
 */
export interface EmployeeListResponse {
  results: Employee[];
  count: number;
  page?: number;
  page_size?: number;
}

/**
 * List all employees with optional filters
 */
export async function listEmployees(
  params?: ListEmployeesParams
): Promise<ApiResponse<EmployeeListResponse>> {
  const { data } = await api.get<ApiResponse<EmployeeListResponse>>(
    "/employees",
    { params }
  );
  return data;
}

/**
 * Get a single employee by ID
 * (Stub for now, will be implemented when view page is built)
 */
export async function getEmployee(
  id: string | number
): Promise<ApiResponse<Employee>> {
  const { data } = await api.get<ApiResponse<Employee>>(
    `/employees/${id}`
  );
  return data;
}

/**
 * Create employee payload (snake_case per API conventions)
 */
export interface CreateEmployeeDto {
  // Personal Info
  full_name: string;
  employee_number?: string; // Phone number per spec
  nationality?: string;
  passport_no?: string;
  passport_expiry?: string; // YYYY-MM-DD
  national_id?: string;
  id_expiry?: string; // YYYY-MM-DD
  date_of_birth?: string; // YYYY-MM-DD
  mobile?: string;

  // Employment Info
  department_id?: number;
  position_id?: number;
  task_group_id?: number;
  sponsor_id?: number;
  job_offer?: string;
  join_date?: string; // YYYY-MM-DD
  contract_date?: string; // YYYY-MM-DD
  contract_expiry?: string; // YYYY-MM-DD
  allowed_overtime?: number;

  // Documents
  health_card?: string;
  health_card_expiry?: string; // YYYY-MM-DD

  // Salary & Allowances
  basic_salary?: number;
  transportation_allowance?: number;
  accommodation_allowance?: number;
  telephone_allowance?: number;
  petrol_allowance?: number;
  other_allowance?: number;
  total_salary?: number;
}

/**
 * Create a new employee
 */
export async function createEmployee(
  payload: CreateEmployeeDto
): Promise<ApiResponse<Employee>> {
  const { data } = await api.post<ApiResponse<Employee>>(
    "/employees",
    payload
  );
  return data;
}

/**
 * Update an existing employee
 */
export async function updateEmployee(
  id: string | number,
  payload: CreateEmployeeDto
): Promise<ApiResponse<Employee>> {
  const { data } = await api.put<ApiResponse<Employee>>(
    `/employees/${id}`,
    payload
  );
  return data;
}



/**
 * Import Status: Aligning with Backend Enum
 */
export type ImportStatus = "pending" | "processing" | "success" | "failed" | string;

/**
 * Import Result Detail (Matches EmployeeImportSerializer)
 */
export interface ImportResult {
  id: string; // Backend 'id'
  status: ImportStatus;
  row_count: number; // Backend 'row_count'
  inserted_rows: number;
  created_at: string;
  uploader: string; // Email of uploader
  error_summary?: string[];
}

/**
 * Import History Item (Matches EmployeeImportSerializer)
 */
export interface ImportHistoryItem {
  id: string;
  status: ImportStatus;
  row_count: number;
  inserted_rows: number;
  created_at: string;
  uploader: string;
  error_summary?: string[];
  // Backend does NOT return original_filename, so we cannot display it unless we add it to backend.
  // We will omit it for now to match backend.
}

/**
 * Upload employees Excel file
 * Endpoint: POST /employees/import/excel
 * Backend return: { "inserted_rows": number } (Synchronous)
 */
export async function importEmployees(file: File): Promise<ApiResponse<{ inserted_rows: number }>> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post<ApiResponse<{ inserted_rows: number }>>(
    "/employees/import/excel",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );
  return data;
}

/**
 * Get status of a specific import
 * Endpoint: GET /imports/employees/{id}
 */
export async function getImportStatus(id: string): Promise<ApiResponse<ImportResult>> {
  const { data } = await api.get<ApiResponse<ImportResult>>(`/imports/employees/${id}`);
  return data;
}

/**
 * Get import history
 * Endpoint: GET /imports/employees/history
 */
export async function getImportHistory(params?: {
  page?: number;
  page_size?: number;
  status?: string;
  date_from?: string;
  date_to?: string;
}): Promise<ApiResponse<{ items: ImportHistoryItem[]; count: number; page?: number; page_size?: number; total_pages?: number }>> {
  // Backend StandardPagination structure is { items: [], count: ..., page, page_size, total_pages }
  const { data } = await api.get<ApiResponse<{ items: ImportHistoryItem[]; count: number; page?: number; page_size?: number; total_pages?: number }>>(
    "/imports/employees/history",
    { params }
  );
  return data;
}

/**
 * Download error file as Blob (Authenticated)
 * Endpoint: GET /imports/employees/{import_id}/errors-file
 */
export async function downloadImportErrors(importId: string): Promise<Blob> {
  const response = await api.get(`/imports/employees/${importId}/errors-file`, {
    responseType: "blob",
  });
  return response.data;
}

/**
 * Download import template
 * Endpoint: GET /employees/import-template
 */
export async function downloadImportTemplate(): Promise<Blob> {
  const response = await api.get("/employees/import-template", {
    responseType: "blob",
  });
  return response.data;
}
