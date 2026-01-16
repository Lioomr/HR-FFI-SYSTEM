import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type LoginRequest = { email: string; password: string };
export type LoginResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    role: "SystemAdmin" | "HRManager" | "Employee";
  };
};

export async function loginApi(payload: LoginRequest) {
  const { data } = await api.post<ApiResponse<LoginResponse>>(
    "/auth/login",
    payload
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
    payload
  );
  return data;
}
