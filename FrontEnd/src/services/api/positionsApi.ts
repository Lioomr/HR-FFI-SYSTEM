import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Position data type
 */
export interface Position {
  id: number;
  name: string;
  code: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Create position payload
 */
export interface CreatePositionDto {
  name: string;
  code: string;
  description?: string;
}

/**
 * Update position payload
 */
export interface UpdatePositionDto {
  name?: string;
  code?: string;
  description?: string;
}

/**
 * List positions query parameters
 */
export interface ListPositionsParams {
  page?: number;
  page_size?: number;
  search?: string;
}

/**
 * List all positions
 */
export async function listPositions(
  params?: ListPositionsParams
): Promise<ApiResponse<Position[]>> {
  const { data } = await api.get<ApiResponse<Position[]>>(
    "/api/hr/positions/",
    { params }
  );
  return data;
}

/**
 * Create a new position
 */
export async function createPosition(
  payload: CreatePositionDto
): Promise<ApiResponse<Position>> {
  const { data } = await api.post<ApiResponse<Position>>(
    "/api/hr/positions/",
    payload
  );
  return data;
}

/**
 * Update an existing position
 */
export async function updatePosition(
  id: string | number,
  payload: UpdatePositionDto
): Promise<ApiResponse<Position>> {
  const { data } = await api.patch<ApiResponse<Position>>(
    `/api/hr/positions/${id}/`,
    payload
  );
  return data;
}
