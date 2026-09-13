import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import { getMyLeaveRequests } from "./leaveApi";
import { getMyLoanRequests } from "./loanApi";
import { getMyPermissionRequests } from "./permissionRequestsApi";

export type CurrentRequestKind = "leave" | "permission" | "loan";
export type CurrentRequest = {
  id: number;
  kind: CurrentRequestKind;
  status: string;
  createdAt?: string;
  reference: string;
  path: string;
};

// Read every page: filtering only the first page can hide an older pending request.
async function readPages<T>(
  fetchPage: (params: {
    page: number;
    page_size: number;
  }) => Promise<ApiResponse<PaginatedResponse<T>>>,
  isActive: () => boolean,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    if (!isActive()) throw new Error("Request view changed");
    const response = await fetchPage({ page, page_size: 100 });
    if (response.status !== "success") throw new Error(response.message);
    items.push(...response.data.items);
    totalPages = response.data.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return items;
}

export async function getEmployeeCurrentRequests(
  isActive: () => boolean = () => true,
) {
  const sources = [
    {
      kind: "leave" as const,
      load: async () =>
        (await readPages(getMyLeaveRequests, isActive)).map((item) => ({
          id: item.id,
          status: item.status,
          createdAt: item.created_at,
          reference: `#${item.id}`,
          kind: "leave" as const,
          path: `/employee/leave/requests/${item.id}`,
        })),
    },
    {
      kind: "permission" as const,
      load: async () =>
        (await readPages(getMyPermissionRequests, isActive)).map((item) => ({
          id: item.id,
          status: item.status,
          createdAt: item.created_at,
          reference: item.reference_no || `#${item.id}`,
          kind: "permission" as const,
          path: `/employee/permission-requests/${item.id}`,
        })),
    },
    {
      kind: "loan" as const,
      load: async () =>
        (await readPages(getMyLoanRequests, isActive)).map((item) => ({
          id: item.id,
          status: item.status,
          createdAt: item.created_at,
          reference: `#${item.id}`,
          kind: "loan" as const,
          path: `/employee/loans/${item.id}`,
        })),
    },
  ];
  const results = await Promise.allSettled(
    sources.map((source) => source.load()),
  );
  const requests: CurrentRequest[] = [];
  const failed: CurrentRequestKind[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") requests.push(...result.value);
    else failed.push(sources[index].kind);
  });
  return {
    requests: requests
      .filter(
        (item) =>
          item.status === "submitted" || item.status.startsWith("pending_"),
      )
      .sort(
        (a, b) =>
          (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id,
      ),
    failed,
  };
}
