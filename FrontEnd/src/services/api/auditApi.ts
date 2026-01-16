import { api } from "./apiClient";
import type { ApiResponse, AuditLogDto, PaginatedResponse } from "./apiTypes";

export type AuditLogsParams = {
  page?: number;
  page_size?: number;
  action?: string;
  actor_email?: string;
  entity?: string;
  entity_id?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
};

export async function listAuditLogs(params: AuditLogsParams = {}) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<AuditLogDto>>>(
    "/audit-logs",
    { params }
  );
  return data;
}

export async function exportAuditLogs(params: AuditLogsParams = {}) {
  const { data } = await api.get<Blob>("/audit-logs/export", {
    params,
    responseType: "blob",
  });
  return data;
}
