import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export interface AssetAssignmentSummary {
  id: number;
  employee: number;
  employee_id: string;
  employee_name: string;
  assigned_by: number | null;
  assigned_at: string;
  is_active: boolean;
}

export interface Asset {
  id: number;
  asset_code: string;
  name?: string;
  name_en: string;
  name_ar: string;
  type: "VEHICLE" | "LAPTOP" | "OTHER";
  status: "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "LOST" | "DAMAGED" | "RETIRED";
  serial_number?: string;
  purchase_date?: string | null;
  warranty_expiry?: string | null;
  asset_value?: string | number | null;
  vendor?: string;
  notes?: string;
  flexible_attributes?: Record<string, { type?: "body" | "date"; body?: string; date?: string | null } | unknown> | null;
  plate_number?: string;
  chassis_number?: string;
  engine_number?: string;
  fuel_type?: string;
  insurance_expiry?: string | null;
  registration_expiry?: string | null;
  cpu?: string;
  ram?: string;
  storage?: string;
  mac_address?: string;
  operating_system?: string;
  active_assignment?: AssetAssignmentSummary | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAssetPayload {
  name_en: string;
  name_ar: string;
  type: "VEHICLE" | "LAPTOP" | "OTHER";
  status?: "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "LOST" | "DAMAGED" | "RETIRED";
  serial_number?: string;
  purchase_date?: string;
  warranty_expiry?: string;
  asset_value?: string | number;
  vendor?: string;
  notes?: string;
  flexible_attributes?: Record<string, { type?: "body" | "date"; body?: string; date?: string | null } | unknown>;
  plate_number?: string;
  chassis_number?: string;
  engine_number?: string;
  fuel_type?: string;
  insurance_expiry?: string;
  registration_expiry?: string;
  cpu?: string;
  ram?: string;
  storage?: string;
  mac_address?: string;
  operating_system?: string;
}

export interface AssetsPaginatedResponse {
  items: Asset[];
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export interface AssetDashboardSummary {
  total: number;
  assigned: number;
  available: number;
  damaged: number;
  lost: number;
  warranty_expiring_soon: number;
}

export interface AssetDamageReport {
  id: number;
  asset: number;
  asset_code: string;
  asset_name: string;
  employee: number;
  employee_name?: string;
  employee_email?: string;
  description: string;
  status: "PENDING_HR" | "PENDING_CEO" | "APPROVED" | "REJECTED";
  reported_at: string;
  ceo_decision_note?: string;
}

export interface AssetReturnRequest {
  id: number;
  asset: number;
  asset_code: string;
  asset_name: string;
  employee: number;
  employee_name?: string;
  employee_email?: string;
  note: string;
  status: "PENDING" | "PENDING_CEO" | "APPROVED" | "PROCESSED" | "REJECTED";
  requested_at: string;
  ceo_decision_note?: string;
}

export async function listAssets(params?: {
  page?: number;
  page_size?: number;
  search?: string;
  type?: string;
  status?: string;
  vendor?: string;
}) {
  const { data } = await api.get<ApiResponse<AssetsPaginatedResponse>>("/api/assets/", { params });
  return data;
}

export async function getAssetsDashboardSummary() {
  const { data } = await api.get<ApiResponse<AssetDashboardSummary>>("/api/assets/dashboard-summary/");
  return data;
}

export async function listMyAssets(params?: { page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<AssetsPaginatedResponse>>("/api/assets/my-assets/", { params });
  return data;
}

export async function createAsset(payload: CreateAssetPayload) {
  const { data } = await api.post<ApiResponse<Asset>>("/api/assets/", payload);
  return data;
}

export async function updateAsset(assetId: number | string, payload: CreateAssetPayload) {
  const { data } = await api.put<ApiResponse<Asset>>(`/api/assets/${assetId}/`, payload);
  return data;
}

export async function assignAsset(assetId: number | string, employeeId: number) {
  const { data } = await api.post<ApiResponse<Asset>>(`/api/assets/${assetId}/assign/`, {
    employee_id: employeeId,
  });
  return data;
}

export async function returnAsset(
  assetId: number | string,
  payload?: {
    return_note?: string;
    condition_on_return?: string;
  }
) {
  const { data } = await api.post<ApiResponse<Asset>>(`/api/assets/${assetId}/return/`, payload || {});
  return data;
}

export async function deleteAsset(assetId: number | string) {
  const { data } = await api.delete<ApiResponse<{ id: number | string }>>(`/api/assets/${assetId}/`);
  return data;
}

export async function reportAssetIssue(
  assetId: number | string,
  payload: {
    description: string;
  }
) {
  const { data } = await api.post<ApiResponse<{ id: number; reported_at: string }>>(
    `/api/assets/${assetId}/damage-report/`,
    payload
  );
  return data;
}

export async function requestAssetReturn(
  assetId: number | string,
  payload: { note: string }
) {
  const { data } = await api.post<ApiResponse<{ id: number; requested_at: string; status: string }>>(
    `/api/assets/${assetId}/return-request/`,
    payload
  );
  return data;
}

export async function getCEOAssetDamageReports(params?: { status?: string; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<{ items: AssetDamageReport[]; count: number } | AssetDamageReport[]>>(
    "/api/assets/ceo/assets/damage-reports/",
    { params }
  );
  return data;
}

export async function approveCEOAssetDamageReport(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<AssetDamageReport>>(
    `/api/assets/ceo/assets/damage-reports/${id}/approve/`,
    { comment }
  );
  return data;
}

export async function rejectCEOAssetDamageReport(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<AssetDamageReport>>(
    `/api/assets/ceo/assets/damage-reports/${id}/reject/`,
    { comment }
  );
  return data;
}

export async function getCEOAssetReturnRequests(params?: { status?: string; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<{ items: AssetReturnRequest[]; count: number } | AssetReturnRequest[]>>(
    "/api/assets/ceo/assets/return-requests/",
    { params }
  );
  return data;
}

export async function approveCEOAssetReturnRequest(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<AssetReturnRequest>>(
    `/api/assets/ceo/assets/return-requests/${id}/approve/`,
    { comment }
  );
  return data;
}

export async function rejectCEOAssetReturnRequest(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<AssetReturnRequest>>(
    `/api/assets/ceo/assets/return-requests/${id}/reject/`,
    { comment }
  );
  return data;
}
