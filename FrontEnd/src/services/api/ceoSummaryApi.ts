import { listJobOffers } from "./jobOffersApi";
import { listContractDecisions } from "./contractDecisionsApi";
import { getAnnualLeavePaymentRequests } from "./annualLeavePaymentsApi";
import { isApiError } from "./apiTypes";
import {
  getCEOAssetDamageReports,
  getCEOAssetReturnRequests,
} from "./assetsApi";
import { getCEOAttendance } from "./attendanceApi";
import { listEmployeeArchiveRequests } from "./employeesApi";
import { getCEOLeaveRequests } from "./leaveApi";
import { getCFOLoanRequests, getCEOLoanRequests } from "./loanApi";

/**
 * Executive approval summary.
 *
 * There is no single backend summary endpoint for the CEO, so this composes the
 * count of each existing CEO queue with a one-row probe (`page_size: 1`) —
 * exactly the calls the individual queue pages already make. Every queue is
 * resolved independently: a CEO who is not an approver for one area still gets
 * a usable dashboard for the rest, and that queue reports itself unavailable
 * rather than failing the page.
 */

export type CeoQueueKey =
  | "leave"
  | "loan"
  | "attendance"
  | "assetDamage"
  | "assetReturn"
  | "employeeArchive"
  | "jobOffers"
  | "contracts"
  | "annualLeave";

export const CEO_QUEUE_KEYS: CeoQueueKey[] = [
  "leave",
  "loan",
  "attendance",
  "assetDamage",
  "assetReturn",
  "employeeArchive",
  "jobOffers",
  "contracts",
  "annualLeave",
];

export interface CeoQueueCount {
  key: CeoQueueKey;
  count: number;
  /** false when the queue could not be read (no access, network, server error) */
  available: boolean;
}

export interface CeoApprovalSummary {
  queues: Record<CeoQueueKey, CeoQueueCount>;
  /** Sum across the queues that could be read. */
  totalPending: number;
  /** No queue could be read at all — the caller should show an error state. */
  allUnavailable: boolean;
}

const PROBE = { page: 1, page_size: 1 } as const;

/** Reads `count` off any of the list shapes the CEO endpoints return. */
function readCount(payload: unknown): number {
  if (!payload) throw new Error("Missing queue data");
  if (Array.isArray(payload)) return payload.length;
  if (typeof payload === "object") {
    const record = payload as {
      count?: unknown;
      items?: unknown;
      results?: unknown;
    };
    if (typeof record.count === "number") return record.count;
    if (Array.isArray(record.items)) return record.items.length;
    if (Array.isArray(record.results)) return record.results.length;
  }
  throw new Error("Invalid queue data");
}

async function probe(loader: () => Promise<unknown>): Promise<number> {
  const response = (await loader()) as { status?: string; data?: unknown };
  if (response && isApiError(response as never)) {
    throw new Error(
      (response as { message?: string }).message || "Request failed",
    );
  }
  return readCount(response?.data);
}

export async function getCeoApprovalSummary(): Promise<CeoApprovalSummary> {
  const loaders: Record<CeoQueueKey, () => Promise<unknown>> = {
    jobOffers: () =>
      listJobOffers({ approval_status: "pending_ceo", ...PROBE }),
    contracts: () => listContractDecisions({ status: "PENDING_CEO", ...PROBE }),
    annualLeave: () =>
      getAnnualLeavePaymentRequests({ status: "pending_ceo", ...PROBE }),
    leave: () => getCEOLeaveRequests({ ...PROBE }),
    loan: () => getCEOLoanRequests({ status: "pending_ceo", ...PROBE }),
    attendance: () => getCEOAttendance({ status: "PENDING_CEO", ...PROBE }),
    assetDamage: () =>
      getCEOAssetDamageReports({ status: "PENDING_CEO", ...PROBE }),
    assetReturn: () =>
      getCEOAssetReturnRequests({ status: "PENDING_CEO", ...PROBE }),
    employeeArchive: () =>
      listEmployeeArchiveRequests({ status: "PENDING_CEO", ...PROBE }),
  };

  const settled = await Promise.allSettled(
    CEO_QUEUE_KEYS.map((key) => probe(loaders[key])),
  );

  const queues = {} as Record<CeoQueueKey, CeoQueueCount>;
  let totalPending = 0;
  let availableCount = 0;

  CEO_QUEUE_KEYS.forEach((key, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") {
      queues[key] = { key, count: result.value, available: true };
      totalPending += result.value;
      availableCount += 1;
    } else {
      queues[key] = { key, count: 0, available: false };
    }
  });

  return { queues, totalPending, allUnavailable: availableCount === 0 };
}

export type CfoApprovalSummary = Omit<CeoApprovalSummary, "queues"> & {
  queues: Pick<CeoApprovalSummary["queues"], "loan">;
};

export async function getCfoApprovalSummary(): Promise<CfoApprovalSummary> {
  const count = await probe(() =>
    getCFOLoanRequests({ status: "pending_cfo", ...PROBE }),
  );
  return {
    queues: { loan: { key: "loan", count, available: true } },
    totalPending: count,
    allUnavailable: false,
  };
}
