import { api } from "./apiClient";
import type { ApiResponse, OrganizationNodeDto } from "./apiTypes";

/**
 * The backend resolves `identifier` as either an email or a phone number, and
 * falls back to the legacy `email` field only when `identifier` is absent.
 */
export type LoginRequest = { identifier: string; password: string };
export type LoginResponse = {
  token: string;
  access?: string;
  refresh?: string;
  user: {
    id: string;
    email: string;
    role: "SystemAdmin" | "HRManager" | "Manager" | "Employee" | "CEO" | "CFO";
    accessible_organizations?: OrganizationNodeDto[];
    default_organization_id?: number | string | null;
    has_all_company_access?: boolean;
  };
};

export async function loginApi(payload: LoginRequest) {
  const { data } = await api.post<ApiResponse<LoginResponse>>(
    "/auth/login",
    payload,
  );
  return data;
}

export async function logoutApi() {
  const { data } = await api.post<ApiResponse<{}>>("/auth/logout", {});
  return data;
}

export type ChangePasswordRequest = {
  current_password: string;
  new_password: string;
};

export async function changePasswordApi(payload: ChangePasswordRequest) {
  const { data } = await api.post<ApiResponse<{}>>(
    "/auth/change-password",
    payload,
  );
  return data;
}

/**
 * Consumes the one-time token from an emailed password-reset link. Unlike
 * `changePasswordApi`, this does not require an authenticated session — the
 * token itself is the credential.
 */
export type ResetPasswordConfirmRequest = {
  uid: string;
  token: string;
  new_password: string;
};

export async function resetPasswordConfirmApi(
  payload: ResetPasswordConfirmRequest,
) {
  const { data } = await api.post<ApiResponse<{}>>(
    "/auth/reset-password/confirm",
    payload,
  );
  return data;
}
