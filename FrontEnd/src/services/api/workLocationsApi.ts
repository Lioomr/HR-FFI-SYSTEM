import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * Mirrors `Backend/attendance/serializers.py::WorkLocationSerializer`.
 *
 * DRF serialises `DecimalField(max_digits=9, decimal_places=6)` as a string,
 * so `latitude`/`longitude` arrive as `"24.713600"` rather than a number.
 * `radius_meters` is a plain positive integer in metres.
 */
export interface WorkLocation {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  radius_meters: number;
  /** Read-only. DELETE flips this to `false`; the list only returns active rows. */
  is_active: boolean;
  company_id: number;
  company_name: string;
  created_at: string;
  updated_at: string;
}

/**
 * The complete set of writable fields, exactly as published in
 * `plans/Geofenced Attendance Phase 8 Backend Contract.md`.
 *
 * `company` and `company_id` are server-injected from the active-company
 * context and are rejected with 422 if a client sends them.
 */
export interface WorkLocationWritePayload {
  name: string;
  latitude: string;
  longitude: string;
  radius_meters: number;
}

export type CreateWorkLocationDto = WorkLocationWritePayload;

/** PUT requires every writable field. */
export type UpdateWorkLocationDto = WorkLocationWritePayload;

/** PATCH may send any subset of the writable fields. */
export type PatchWorkLocationDto = Partial<WorkLocationWritePayload>;

export interface ListWorkLocationsParams {
  page?: number;
  page_size?: number;
}

const BASE_URL = "/api/work-locations/";

/**
 * Backend stores six decimal places. Formatting here keeps the request body
 * byte-identical to the published contract example (`"24.713600"`) instead of
 * letting JS number formatting emit `24.7136`.
 */
export function formatCoordinate(value: number | string): string {
  return Number(value).toFixed(6);
}

/**
 * What a caller may hand the payload builders.
 *
 * Ant Design's `InputNumber` yields strings in `stringMode` but numbers
 * otherwise, so both are accepted and normalised on the way out. Extra keys are
 * tolerated by the type but dropped by the builders.
 */
export type WorkLocationFormInput = {
  name?: string;
  latitude?: string | number;
  longitude?: string | number;
  radius_meters?: string | number;
} & Record<string, unknown>;

/**
 * Whitelists the four writable fields.
 *
 * This is deliberately a hard allow-list rather than a `delete payload.company`
 * blacklist: it makes it structurally impossible for a caller to leak `company`
 * or `company_id` into a request, which the backend answers with 422.
 */
export function toWritePayload(
  values: WorkLocationFormInput,
): WorkLocationWritePayload {
  return {
    name: String(values.name ?? "").trim(),
    latitude: formatCoordinate(values.latitude ?? ""),
    longitude: formatCoordinate(values.longitude ?? ""),
    radius_meters: Number(values.radius_meters),
  };
}

/** Same allow-list as `toWritePayload`, but omits fields the caller left out. */
export function toPatchPayload(
  values: WorkLocationFormInput,
): PatchWorkLocationDto {
  const payload: PatchWorkLocationDto = {};
  if (values.name !== undefined) payload.name = String(values.name).trim();
  if (values.latitude !== undefined)
    payload.latitude = formatCoordinate(values.latitude);
  if (values.longitude !== undefined)
    payload.longitude = formatCoordinate(values.longitude);
  if (values.radius_meters !== undefined)
    payload.radius_meters = Number(values.radius_meters);
  return payload;
}

/**
 * List the active work locations of the currently selected company.
 *
 * Scoping comes solely from the `x-active-company-id` header injected by
 * `apiClient`; no company query parameter is ever sent.
 */
export async function listWorkLocations(
  params?: ListWorkLocationsParams,
): Promise<ApiResponse<PaginatedResponse<WorkLocation>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<WorkLocation>>>(
    BASE_URL,
    { params },
  );
  return data;
}

export async function getWorkLocation(
  id: string | number,
): Promise<ApiResponse<WorkLocation>> {
  const { data } = await api.get<ApiResponse<WorkLocation>>(
    `${BASE_URL}${id}/`,
  );
  return data;
}

/** Creates within the active company. Responds 201 on success. */
export async function createWorkLocation(
  payload: CreateWorkLocationDto,
): Promise<ApiResponse<WorkLocation>> {
  const { data } = await api.post<ApiResponse<WorkLocation>>(BASE_URL, payload);
  return data;
}

/** Full update. Sends every writable field, as PUT requires. */
export async function updateWorkLocation(
  id: string | number,
  payload: UpdateWorkLocationDto,
): Promise<ApiResponse<WorkLocation>> {
  const { data } = await api.put<ApiResponse<WorkLocation>>(
    `${BASE_URL}${id}/`,
    payload,
  );
  return data;
}

/** Partial update for a subset of writable fields. */
export async function patchWorkLocation(
  id: string | number,
  payload: PatchWorkLocationDto,
): Promise<ApiResponse<WorkLocation>> {
  const { data } = await api.patch<ApiResponse<WorkLocation>>(
    `${BASE_URL}${id}/`,
    payload,
  );
  return data;
}

/**
 * Soft delete. The backend flips `is_active` to `false` and answers
 * `{ status: "success", data: {} }`; the row disappears from the list.
 */
export async function deleteWorkLocation(
  id: string | number,
): Promise<ApiResponse<Record<string, never>>> {
  const { data } = await api.delete<ApiResponse<Record<string, never>>>(
    `${BASE_URL}${id}/`,
  );
  return data;
}
