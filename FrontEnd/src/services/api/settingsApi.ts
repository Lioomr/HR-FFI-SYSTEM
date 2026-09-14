import { api } from "./apiClient";
import type {
  ApiResponse,
  AttendancePolicySettings,
  SettingsDto,
} from "./apiTypes";

/** Removes the deprecated grace alias so only the canonical field is sent. */
export function withoutLegacyGraceAlias(
  attendance: AttendancePolicySettings,
): AttendancePolicySettings {
  const { late_grace_minutes: legacy, ...rest } = attendance;
  if (rest.grace_window_minutes === undefined && legacy !== undefined) {
    return { ...rest, grace_window_minutes: legacy };
  }
  return rest;
}

/** Attendance-only update, allowed for HR Manager and System Admin. */
export async function updateAttendancePolicy(
  attendance: AttendancePolicySettings,
) {
  const { data } = await api.put<ApiResponse<SettingsDto>>("/settings/", {
    attendance: withoutLegacyGraceAlias(attendance),
  });
  return data;
}

export async function getSettings() {
  const { data } = await api.get<ApiResponse<SettingsDto>>("/settings/");
  return data;
}

export async function updateSettings(payload: SettingsDto) {
  const { data } = await api.put<ApiResponse<SettingsDto>>(
    "/settings/",
    payload,
  );
  return data;
}
