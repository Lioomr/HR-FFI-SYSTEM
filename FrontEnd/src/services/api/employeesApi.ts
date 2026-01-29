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
  manager_id?: number;
  manager_name?: string;
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
 * Import Status: Aligning with common backend states.
 * Using string union to capture likely states, but staying flexible if backend differs slightly.
 */
export type ImportStatus = "pending" | "processing" | "success" | "failed" | string;

/**
 * Import Result Detail
 */
export interface ImportResult {
  import_id: string;
  status: ImportStatus;
  total_rows?: number;
  inserted_rows?: number;
  failed_rows?: number;
  error_file_url?: string; // May be deprecated in favor of explicit endpoint
  created_at: string;
  error_summary?: string[];
}

/**
 * Import History Item
 */
export interface ImportHistoryItem {
  id: string;
  file_name: string;
  uploaded_by: string;
  uploaded_at: string;
  status: ImportStatus;
  inserted_rows: number;
  total_rows: number;
  has_error_file: boolean;
  error_file_url?: string;
}

/**
 * Upload employees Excel file
 * Endpoint: POST /employees/import/excel
 */
export async function importEmployees(file: File): Promise<ApiResponse<{ import_id: string }>> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post<ApiResponse<{ import_id: string }>>(
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
 * Endpoint: GET /imports/employees/{importId} (Assumed based on history path)
 * Wait - verify if spec endpoint for status was given. 
 * User said: "History under /imports/employees... (and error-file download via /imports/employees/{import_id}/errors-file)"
 * AND "GET /employees/import/{importId}" was flagged as wrong? 
 * Actually user said "But the authoritative contract requires: POST /employees/import/excel ... History under /imports/employees..."
 * They didn't explicitly rename the single status endpoint, but implied /imports structure.
 * Safe bet: GET /imports/employees/{importId} for detail if history is there.
 * Let's assume /imports/employees/{id} aligns with Restful structure.
 */
export async function getImportStatus(importId: string): Promise<ApiResponse<ImportResult>> {
  const { data } = await api.get<ApiResponse<ImportResult>>(`/imports/employees/${importId}`);
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
}): Promise<ApiResponse<{ results: ImportHistoryItem[]; count: number }>> {
  const { data } = await api.get<ApiResponse<{ results: ImportHistoryItem[]; count: number }>>(
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
