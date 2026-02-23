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
  name: string;
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
  name: string;
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
