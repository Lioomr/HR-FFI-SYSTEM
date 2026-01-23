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
