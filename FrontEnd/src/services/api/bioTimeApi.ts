import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import { unwrapEnvelope } from "../../utils/dataUtils";

/**
 * BioTime configuration as returned by GET /api/biotime/config/.
 * The backend never returns the password, so it is not part of the read model.
 */
export interface BioTimeConfig {
  server_ip: string;
  server_port: string;
  username: string;
  is_active: boolean;
  last_sync_time?: string | null;
}

/**
 * Payload for PUT /api/biotime/config/.
 * `password` must only be sent when the user actually typed a new one:
 * the backend keeps the stored password when the field is blank/absent.
 */
export interface BioTimeConfigPayload extends Partial<BioTimeConfig> {
  password?: string;
}

export interface BioTimeEmployeeMap {
  id: number;
  employee_profile: number;
  employee_name: string;
  department: string;
  biotime_emp_code: string;
  created_at: string;
}

export interface UnmappedBioTimeUser {
  emp_code: string;
  first_name: string;
  last_name: string;
  department: string;
}

/** StandardPagination envelope payload: { items, page, page_size, count, total_pages }. */
export interface BioTimePage<T> {
  items: T[];
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export interface BioTimePageParams {
  page?: number;
  page_size?: number;
}

export interface BioTimeSyncSummary {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  unmapped: number;
  invalid: number;
}

export interface BioTimeSyncResult {
  message: string;
  summary: BioTimeSyncSummary;
}

export interface CreateBioTimeMappingPayload {
  employee_profile: number;
  biotime_emp_code: string;
}

/** Default look-back window (in days) for a manual sync. */
export const DEFAULT_SYNC_DAYS_BACK = 7;

const toCount = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Normalizes the paginated payload. The backend falls back to
 * `{ items, count }` (no page metadata) when pagination is disabled,
 * so page/page_size/total_pages are derived when missing.
 */
export function normalizeBioTimePage<T>(
  payload: unknown,
  params?: BioTimePageParams,
): BioTimePage<T> {
  const source = (payload ?? {}) as Record<string, unknown>;
  const items = Array.isArray(source.items)
    ? (source.items as T[])
    : Array.isArray(source.results)
      ? (source.results as T[])
      : Array.isArray(payload)
        ? (payload as T[])
        : [];

  const requestedPageSize = toCount(params?.page_size, 0);
  const pageSize = toCount(
    source.page_size,
    requestedPageSize || items.length || 0,
  );
  const count = toCount(source.count, items.length);
  const totalPages = toCount(
    source.total_pages,
    pageSize > 0 ? Math.max(1, Math.ceil(count / pageSize)) : 1,
  );

  return {
    items,
    page: toCount(source.page, toCount(params?.page, 1)),
    page_size: pageSize,
    count,
    total_pages: totalPages,
  };
}

export const bioTimeApi = {
  // ── Config ────────────────────────────────────────────────────────────────
  getConfig: async (): Promise<BioTimeConfig> => {
    const { data } = await api.get<ApiResponse<BioTimeConfig>>(
      "/api/biotime/config/",
    );
    return unwrapEnvelope(data);
  },

  updateConfig: async (
    payload: BioTimeConfigPayload,
  ): Promise<BioTimeConfig> => {
    const { data } = await api.put<ApiResponse<BioTimeConfig>>(
      "/api/biotime/config/",
      payload,
    );
    return unwrapEnvelope(data);
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  testConnection: async (
    payload: BioTimeConfigPayload,
  ): Promise<{ connected: boolean }> => {
    const { data } = await api.post<ApiResponse<{ connected: boolean }>>(
      "/api/biotime/actions/test-connection/",
      payload,
    );
    return unwrapEnvelope(data);
  },

  syncNow: async (
    daysBack: number = DEFAULT_SYNC_DAYS_BACK,
  ): Promise<BioTimeSyncResult> => {
    const { data } = await api.post<ApiResponse<Partial<BioTimeSyncSummary>>>(
      "/api/biotime/actions/sync-now/",
      { days_back: daysBack },
    );
    const counts = unwrapEnvelope(data) ?? {};
    return {
      message: (data as { message?: string }).message || "",
      summary: {
        processed: toCount(counts.processed),
        created: toCount(counts.created),
        updated: toCount(counts.updated),
        skipped: toCount(counts.skipped),
        unmapped: toCount(counts.unmapped),
        invalid: toCount(counts.invalid),
      },
    };
  },

  // ── Mappings ──────────────────────────────────────────────────────────────
  getMappings: async (
    params?: BioTimePageParams,
  ): Promise<BioTimePage<BioTimeEmployeeMap>> => {
    const { data } = await api.get<
      ApiResponse<BioTimePage<BioTimeEmployeeMap>>
    >("/api/biotime-mappings/", {
      params,
    });
    return normalizeBioTimePage<BioTimeEmployeeMap>(
      unwrapEnvelope(data),
      params,
    );
  },

  createMapping: async (
    payload: CreateBioTimeMappingPayload,
  ): Promise<BioTimeEmployeeMap> => {
    const { data } = await api.post<ApiResponse<BioTimeEmployeeMap>>(
      "/api/biotime-mappings/",
      payload,
    );
    return unwrapEnvelope(data);
  },

  deleteMapping: async (id: number): Promise<void> => {
    await api.delete(`/api/biotime-mappings/${id}/`);
  },

  getUnmappedUsers: async (
    params?: BioTimePageParams,
  ): Promise<BioTimePage<UnmappedBioTimeUser>> => {
    const { data } = await api.get<
      ApiResponse<BioTimePage<UnmappedBioTimeUser>>
    >("/api/biotime-mappings/unmapped/", { params });
    return normalizeBioTimePage<UnmappedBioTimeUser>(
      unwrapEnvelope(data),
      params,
    );
  },
};
