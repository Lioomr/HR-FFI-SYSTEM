import { isApiError } from "./apiTypes";
import {
    getManagerAssetReturnRequests,
    getManagerLeaveRequests,
    type ManagerLeaveRequest,
} from "./managerApi";
import { getManagerLoanRequests, type LoanRequest } from "./loanApi";
import {
    listAttendanceCorrectionRequests,
    type AttendanceCorrectionRequest,
} from "./attendanceCorrectionsApi";
import type { AssetReturnRequest } from "./assetsApi";

/**
 * Team work summary for the manager dashboard.
 *
 * There is no single backend summary endpoint for a manager, so this composes
 * the queues the manager pages already read. Every queue resolves independently:
 * a manager who is not an approver for one area still gets a usable dashboard
 * for the rest, and that queue reports itself unavailable instead of failing the
 * whole page — the same contract as the CEO summary.
 *
 * Unlike the CEO summary this also returns the pending rows themselves, because
 * the dashboard shows a real work queue (who, what, how long it has waited) and
 * not only counts.
 */

export type ManagerQueueKey = "leave" | "loan" | "attendance" | "assetReturn";

export const MANAGER_QUEUE_KEYS: ManagerQueueKey[] = [
    "leave",
    "loan",
    "attendance",
    "assetReturn",
];

/** One pending row, normalised across the four queues. */
export interface ManagerPendingItem {
    /** Unique across queues — request ids only collide between them. */
    key: string;
    queue: ManagerQueueKey;
    id: number;
    employeeName: string;
    employeeEmail: string;
    /** The one line that identifies the request, e.g. a leave type or an amount. */
    detail: string;
    status: string;
    /** ISO timestamp the request started waiting; null when the API omits it. */
    submittedAt: string | null;
    /** Where the review action goes. */
    path: string;
}

export interface ManagerQueueState {
    key: ManagerQueueKey;
    count: number;
    /** false when the queue could not be read (no access, network, server error) */
    available: boolean;
    items: ManagerPendingItem[];
}

export interface ManagerWorkSummary {
    queues: Record<ManagerQueueKey, ManagerQueueState>;
    /** Every pending row across the readable queues, oldest first. */
    items: ManagerPendingItem[];
    /** Sum across the queues that could be read. */
    totalPending: number;
    /** No queue could be read at all — the caller should show an error state. */
    allUnavailable: boolean;
}

/** Page size for the queue probes: enough to rank a backlog, small enough to stay cheap. */
const QUEUE_PAGE_SIZE = 50;

const PENDING_MANAGER_LEAVE = new Set(["pending_manager", "submitted"]);

function displayName(name?: string | null, email?: string | null) {
    return name?.trim() || email?.trim() || "";
}

async function readLeave(): Promise<ManagerPendingItem[]> {
    const res = await getManagerLeaveRequests("pending_manager");
    if (isApiError(res)) throw new Error(res.message);
    const rows = (res.data ?? []) as ManagerLeaveRequest[];
    return rows
        .filter((row) => PENDING_MANAGER_LEAVE.has(String(row.status || "").toLowerCase()))
        .map((row) => ({
            key: `leave-${row.id}`,
            queue: "leave" as const,
            id: row.id,
            employeeName: displayName(row.employee?.full_name, row.employee?.email),
            employeeEmail: row.employee?.email || "",
            detail: row.leave_type?.name || "",
            status: row.status,
            submittedAt: row.created_at || null,
            path: `/manager/leave/requests/${row.id}`,
        }));
}

async function readLoan(): Promise<ManagerPendingItem[]> {
    const res = await getManagerLoanRequests({
        status: "pending_manager",
        page: 1,
        page_size: QUEUE_PAGE_SIZE,
    });
    if (isApiError(res)) throw new Error(res.message);
    const rows = (res.data?.items ?? []) as LoanRequest[];
    return rows.map((row) => ({
        key: `loan-${row.id}`,
        queue: "loan" as const,
        id: row.id,
        employeeName: displayName(row.employee?.full_name, row.employee?.email),
        employeeEmail: row.employee?.email || "",
        // Formatted by the caller, which owns the locale-aware number format.
        detail: String(row.requested_amount ?? ""),
        status: row.status,
        submittedAt: row.created_at || null,
        path: `/manager/loan-requests/${row.id}`,
    }));
}

async function readAttendance(): Promise<ManagerPendingItem[]> {
    const res = await listAttendanceCorrectionRequests({
        status: "pending_manager",
        page: 1,
        page_size: QUEUE_PAGE_SIZE,
    });
    if (isApiError(res)) throw new Error(res.message);
    const rows = (res.data?.results ?? []) as AttendanceCorrectionRequest[];
    return rows.map((row) => ({
        key: `attendance-${row.id}`,
        queue: "attendance" as const,
        id: row.id,
        employeeName: displayName(row.employee_name, row.employee_email),
        employeeEmail: row.employee_email || "",
        detail: row.date || "",
        status: row.status,
        submittedAt: row.submitted_at || row.created_at || null,
        path: "/manager/attendance-corrections",
    }));
}

async function readAssetReturn(): Promise<ManagerPendingItem[]> {
    // The endpoint ignores an unknown status filter on some deployments, so the
    // pending rows are selected here rather than trusted from the query.
    const res = await getManagerAssetReturnRequests();
    if (isApiError(res)) throw new Error(res.message);
    const rows = (res.data ?? []) as AssetReturnRequest[];
    return rows
        .filter((row) => row.status === "PENDING_MANAGER")
        .map((row) => ({
            key: `asset-${row.id}`,
            queue: "assetReturn" as const,
            id: row.id,
            employeeName: displayName(row.employee_name, row.employee_email),
            employeeEmail: row.employee_email || "",
            detail: row.asset_name || row.asset_code || "",
            status: row.status,
            submittedAt: row.requested_at || null,
            path: "/manager/team-requests?tab=asset-returns",
        }));
}

const LOADERS: Record<ManagerQueueKey, () => Promise<ManagerPendingItem[]>> = {
    leave: readLeave,
    loan: readLoan,
    attendance: readAttendance,
    assetReturn: readAssetReturn,
};

/** Oldest first; rows with no timestamp sink to the bottom. */
function byAgeDescending(a: ManagerPendingItem, b: ManagerPendingItem) {
    if (!a.submittedAt && !b.submittedAt) return 0;
    if (!a.submittedAt) return 1;
    if (!b.submittedAt) return -1;
    return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
}

export async function getManagerWorkSummary(): Promise<ManagerWorkSummary> {
    const settled = await Promise.allSettled(
        MANAGER_QUEUE_KEYS.map((key) => LOADERS[key]()),
    );

    const queues = {} as Record<ManagerQueueKey, ManagerQueueState>;
    const items: ManagerPendingItem[] = [];
    let totalPending = 0;
    let availableCount = 0;

    MANAGER_QUEUE_KEYS.forEach((key, index) => {
        const result = settled[index];
        if (result.status === "fulfilled") {
            queues[key] = { key, count: result.value.length, available: true, items: result.value };
            items.push(...result.value);
            totalPending += result.value.length;
            availableCount += 1;
        } else {
            queues[key] = { key, count: 0, available: false, items: [] };
        }
    });

    return {
        queues,
        items: items.sort(byAgeDescending),
        totalPending,
        allUnavailable: availableCount === 0,
    };
}
