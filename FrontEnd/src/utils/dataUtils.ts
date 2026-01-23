import type { ApiResponse } from '../services/api/apiTypes';

/**
 * Helper to extract the actual data from the API envelope
 * Per Global API Rules (v1): Success envelope is { status: "success", data: ... }
 * 
 * @throws Error if the response status is "error"
 * @param response - API response following the contract
 * @returns The unwrapped data
 */
export function unwrapEnvelope<T>(response: ApiResponse<T>): T {
  // Check for error status
  if (response.status === "error") {
    throw new Error(response.message || "API Error");
  }

  // Return the data from success envelope
  return response.data;
}

// Helper to normalize list responses that might be:
// 1. Array: [...]
// 2. { items: [...], total: ... }
// 3. { results: [...], count: ... }
export interface ListResponse<T> {
  items: T[];
  total: number;
}

export function normalizeListData<T>(payload: any): ListResponse<T> {
  if (!payload) {
      return { items: [], total: 0 };
  }
  if (Array.isArray(payload)) {
    return { items: payload, total: payload.length };
  }
  if (typeof payload === "object") {
    if (Array.isArray(payload.items)) {
      return { items: payload.items, total: payload.total ?? payload.items.length };
    }
    if (Array.isArray(payload.results)) {
      return { items: payload.results, total: payload.count ?? payload.results.length };
    }
  }
  return { items: [], total: 0 };
}
