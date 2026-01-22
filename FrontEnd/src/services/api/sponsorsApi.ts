import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Sponsor data type
 * Note: code is required, name is optional per specs
 */
export interface Sponsor {
  id: number;
  code: string;
  name?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Create sponsor payload
 * code is required, name is optional
 */
export interface CreateSponsorDto {
  code: string;
  name?: string;
  description?: string;
}

/**
 * Update sponsor payload
 */
export interface UpdateSponsorDto {
  code?: string;
  name?: string;
  description?: string;
}

/**
 * List sponsors query parameters
 */
export interface ListSponsorsParams {
  page?: number;
  page_size?: number;
  search?: string;
}

/**
 * List all sponsors
 */
export async function listSponsors(
  params?: ListSponsorsParams
): Promise<ApiResponse<Sponsor[]>> {
  const { data } = await api.get<ApiResponse<Sponsor[]>>(
    "/api/hr/sponsors/",
    { params }
  );
  return data;
}

/**
 * Create a new sponsor
 */
export async function createSponsor(
  payload: CreateSponsorDto
): Promise<ApiResponse<Sponsor>> {
  const { data } = await api.post<ApiResponse<Sponsor>>(
    "/api/hr/sponsors/",
    payload
  );
  return data;
}

/**
 * Update an existing sponsor
 */
export async function updateSponsor(
  id: string | number,
  payload: UpdateSponsorDto
): Promise<ApiResponse<Sponsor>> {
  const { data } = await api.patch<ApiResponse<Sponsor>>(
    `/api/hr/sponsors/${id}/`,
    payload
  );
  return data;
}
