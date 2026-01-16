import { api } from "./apiClient";
import type { ApiResponse, Role, UserDto } from "./apiTypes";

export type UsersListResponse = { items: UserDto[] };

export type UsersListParams = {
  search?: string;
  role?: Role;
  status?: "active" | "inactive";
};

export type CreateUserRequest = {
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

export type UpdateUserStatusRequest = {
  is_active: boolean;
};

export type UpdateUserRoleRequest = {
  role: Role;
};

export type ResetPasswordRequest = {
  mode: "temporary_password" | "reset_link";
};

export type ResetPasswordResponse = {
  mode: "temporary_password" | "reset_link";
  temporary_password?: string;
  reset_token?: string;
};

export async function listUsers(params: UsersListParams = {}) {
  const { data } = await api.get<ApiResponse<UsersListResponse>>("/users", {
    params,
  });
  return data;
}

export async function createUser(payload: CreateUserRequest) {
  const { data } = await api.post<ApiResponse<UserDto>>("/users", payload);
  return data;
}

export async function updateUserStatus(
  userId: number | string,
  payload: UpdateUserStatusRequest
) {
  const { data } = await api.patch<ApiResponse<UserDto>>(
    `/users/${userId}/status`,
    payload
  );
  return data;
}

export async function updateUserRole(
  userId: number | string,
  payload: UpdateUserRoleRequest
) {
  const { data } = await api.put<ApiResponse<UserDto>>(
    `/users/${userId}/role`,
    payload
  );
  return data;
}

export async function resetUserPassword(
  userId: number | string,
  payload: ResetPasswordRequest
) {
  const { data } = await api.post<ApiResponse<ResetPasswordResponse>>(
    `/users/${userId}/reset-password`,
    payload
  );
  return data;
}
