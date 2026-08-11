import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

export const EMPLOYEE_LEAVE_BACKDATE_DAYS = 7;

export function isEmployeeLeaveDateDisabled(current: Dayjs | null, today: Dayjs = dayjs()): boolean {
    if (!current) return false;
    const earliestStartDate = today.startOf("day").subtract(EMPLOYEE_LEAVE_BACKDATE_DAYS, "day");
    return current.startOf("day").isBefore(earliestStartDate);
}

type LeaveValidationError = { field?: string; message: string };

export function getLeaveValidationErrors(error: unknown): LeaveValidationError[] {
    const err = error as { apiData?: unknown; response?: { data?: unknown } } | undefined;
    const data = (err?.apiData || err?.response?.data) as { errors?: unknown } | undefined;
    if (!Array.isArray(data?.errors)) return [];

    return data.errors.flatMap((entry): LeaveValidationError[] => {
        if (typeof entry === "string") {
            const match = entry.match(/^([^:]+):\s*(.+)$/);
            return [{ field: match?.[1], message: match?.[2] || entry }];
        }
        if (entry && typeof entry === "object" && "message" in entry) {
            const item = entry as { field?: unknown; message?: unknown };
            if (typeof item.message === "string") {
                return [{ field: typeof item.field === "string" ? item.field : undefined, message: item.message }];
            }
        }
        return [];
    });
}
