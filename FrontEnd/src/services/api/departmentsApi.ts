import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Department data type
 */
export interface Department {
  id: number;
  name: string;
  code: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Create department payload
 */
export interface CreateDepartmentDto {
  name: string;
  code: string;
  description?: string;
}

/**
 * Update department payload
 */
export interface UpdateDepartmentDto {
  name?: string;
  code?: string;
  description?: string;
}

/**
 * List departments query parameters
 */
export interface ListDepartmentsParams {
  page?: number;
  page_size?: number;
  search?: string;
}

/**
 * List all departments
 */
export async function listDepartments(
  params?: ListDepartmentsParams
): Promise<ApiResponse<Department[]>> {
  const { data } = await api.get<ApiResponse<Department[]>>(
    "/api/hr/departments/",
    { params }
  );
  return data;
}

/**
 * Create a new department
 */
export async function createDepartment(
  payload: CreateDepartmentDto
): Promise<ApiResponse<Department>> {
  const { data } = await api.post<ApiResponse<Department>>(
    "/api/hr/departments/",
    payload
  );
  return data;
}

/**
 * Update an existing department
 */
export async function updateDepartment(
  id: string | number,
  payload: UpdateDepartmentDto
): Promise<ApiResponse<Department>> {
  const { data } = await api.patch<ApiResponse<Department>>(
    `/api/hr/departments/${id}/`,
    payload
  );
  return data;
}
