import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Task Group data type
 */
export interface TaskGroup {
  id: number;
  name: string;
  code: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Create task group payload
 */
export interface CreateTaskGroupDto {
  name: string;
  code: string;
  description?: string;
}

/**
 * Update task group payload
 */
export interface UpdateTaskGroupDto {
  name?: string;
  code?: string;
  description?: string;
}

/**
 * List task groups query parameters
 */
export interface ListTaskGroupsParams {
  page?: number;
  page_size?: number;
  search?: string;
}

/**
 * List all task groups
 */
export async function listTaskGroups(
  params?: ListTaskGroupsParams
): Promise<ApiResponse<TaskGroup[]>> {
  const { data } = await api.get<ApiResponse<TaskGroup[]>>(
    "/api/hr/task-groups/",
    { params }
  );
  return data;
}

/**
 * Create a new task group
 */
export async function createTaskGroup(
  payload: CreateTaskGroupDto
): Promise<ApiResponse<TaskGroup>> {
  const { data } = await api.post<ApiResponse<TaskGroup>>(
    "/api/hr/task-groups/",
    payload
  );
  return data;
}

/**
 * Update an existing task group
 */
export async function updateTaskGroup(
  id: string | number,
  payload: UpdateTaskGroupDto
): Promise<ApiResponse<TaskGroup>> {
  const { data } = await api.patch<ApiResponse<TaskGroup>>(
    `/api/hr/task-groups/${id}/`,
    payload
  );
  return data;
}
