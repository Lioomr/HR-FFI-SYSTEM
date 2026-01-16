import { api } from "./apiClient";
import type { ApiResponse, InviteDto, PaginatedResponse, Role } from "./apiTypes";

export type InvitesListParams = {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
};

export type CreateInviteRequest = {
  email: string;
  role: Role;
  expires_in_hours?: number;
};

export async function listInvites(params: InvitesListParams = {}) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<InviteDto>>>(
    "/invites",
    { params }
  );
  return data;
}

export async function createInvite(payload: CreateInviteRequest) {
  const { data } = await api.post<ApiResponse<InviteDto>>("/invites", payload);
  return data;
}

export async function resendInvite(inviteId: number | string) {
  const { data } = await api.post<ApiResponse<InviteDto>>(
    `/invites/${inviteId}/resend`,
    {}
  );
  return data;
}

export async function revokeInvite(inviteId: number | string) {
  const { data } = await api.delete<ApiResponse<{}>>(`/invites/${inviteId}`);
  return data;
}
