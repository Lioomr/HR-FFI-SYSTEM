import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export interface UserPreference {
  id?: number;
  scope: string;
  key: string;
  value: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getUserPreference(scope: string, key: string): Promise<ApiResponse<UserPreference>> {
  const { data } = await api.get<ApiResponse<UserPreference>>(`/api/core/preferences/${scope}/${key}/`);
  return data;
}

export async function saveUserPreference(
  scope: string,
  key: string,
  value: Record<string, unknown>
): Promise<ApiResponse<UserPreference>> {
  const { data } = await api.put<ApiResponse<UserPreference>>(`/api/core/preferences/${scope}/${key}/`, { value });
  return data;
}
