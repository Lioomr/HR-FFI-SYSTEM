import { api } from "./apiClient";
import type { ApiResponse, SettingsDto } from "./apiTypes";

export async function getSettings() {
  const { data } = await api.get<ApiResponse<SettingsDto>>("/settings");
  return data;
}

export async function updateSettings(payload: SettingsDto) {
  const { data } = await api.put<ApiResponse<SettingsDto>>("/settings", payload);
  return data;
}
