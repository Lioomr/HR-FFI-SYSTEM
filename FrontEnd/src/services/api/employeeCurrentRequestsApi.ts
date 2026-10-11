import type { AnnualLeaveEmployeePreference } from "./annualLeavePaymentsApi";
import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type CurrentRequestKind =
  | "leave"
  | "permission"
  | "loan"
  | "settlement"
  | "profile";
export type CurrentRequest = {
  id: number;
  kind: CurrentRequestKind;
  status: string;
  createdAt?: string;
  reference: string;
  path: string;
  /** Annual Leave settlements only: the contract year being settled. */
  cycle?: { start: string; end: string };
  /** Annual Leave settlements only: blank when HR opened it for the employee. */
  preference?: AnnualLeaveEmployeePreference | "";
};

export async function getEmployeeCurrentRequests(
  isActive: () => boolean = () => true,
) {
  if (!isActive()) return { requests: [], failed: [] };
  try {
    const { data } = await api.get<ApiResponse<{ requests: CurrentRequest[] }>>(
      "/api/employees/me/current-requests/",
    );
    if (!isActive()) return { requests: [], failed: [] };
    if (data.status !== "success") throw new Error(data.message);
    return { requests: data.data.requests ?? [], failed: [] };
  } catch {
    return {
      requests: [],
      failed: [
        "leave",
        "permission",
        "loan",
        "settlement",
        "profile",
      ] as CurrentRequestKind[],
    };
  }
}
