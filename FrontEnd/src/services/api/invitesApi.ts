import { api } from "./apiClient";
import type {
  ApiResponse,
  InviteDto,
  PaginatedResponse,
  Role,
} from "./apiTypes";

export type InvitesListParams = {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
};

export type InviteChannel = "email" | "whatsapp";

export type CreateInviteRequest = {
  channel?: InviteChannel;
  email?: string;
  phone_number?: string;
  role: Role;
  expires_in_hours?: number;
};

export type InviteAcceptInfo = {
  email: string | null;
  phone_number?: string | null;
  channel?: string;
  role: Role;
  expires_at: string;
  /** When the backend explicitly marks phone as required regardless of channel. */
  phone_required?: boolean;
};

export type AcceptInviteRequest = {
  token: string;
  email?: string;
  phone_number?: string;
  full_name?: string;
  password: string;
};

export type WhatsappTestResult = {
  sent: boolean;
  provider?: string | null;
  status_code?: number | null;
  message_id?: string | null;
  error?: string | null;
};

export async function listInvites(params: InvitesListParams = {}) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<InviteDto>>>(
    "/invites/",
    { params },
  );
  return data;
}

export async function createInvite(payload: CreateInviteRequest) {
  const { data } = await api.post<ApiResponse<InviteDto>>("/invites/", payload);
  return data;
}

export async function resendInvite(inviteId: number | string) {
  const { data } = await api.post<ApiResponse<InviteDto>>(
    `/invites/${inviteId}/resend/`,
    {},
  );
  return data;
}

export async function revokeInvite(inviteId: number | string) {
  const { data } = await api.delete<ApiResponse<{}>>(`/invites/${inviteId}/`);
  return data;
}

export async function testWhatsappProvider(phone_number: string) {
  const { data } = await api.post<
    ApiResponse<WhatsappTestResult> | WhatsappTestResult
  >("/invites/test-whatsapp/", { phone_number });
  // Tolerate both the standard {status,data} envelope and a raw delivery payload.
  if (data && typeof data === "object" && "status" in data) {
    return data as ApiResponse<WhatsappTestResult>;
  }
  return {
    status: "success",
    data: data as WhatsappTestResult,
  } satisfies ApiResponse<WhatsappTestResult>;
}

export async function validateInviteToken(token: string) {
  const { data } = await api.get<ApiResponse<InviteAcceptInfo>>(
    "/invites/accept/",
    {
      params: { token },
    },
  );
  return data;
}

export async function acceptInvite(payload: AcceptInviteRequest) {
  const { data } = await api.post<ApiResponse<{ email: string; role: Role }>>(
    "/invites/accept/",
    payload,
  );
  return data;
}
