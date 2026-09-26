import { create } from "zustand";
import type {
  AttendanceRecord,
  AttendanceFilters,
  EffectiveAttendanceStatus,
} from "../types/attendance";
import { getMyAttendance } from "../services/api/attendanceApi";
import { unwrapEnvelope, normalizeListData } from "../utils/dataUtils";

type AttendanceSummary = Partial<Record<EffectiveAttendanceStatus, number>>;

interface EmployeeAttendanceState {
  records: AttendanceRecord[];
  total: number;
  /** Period totals by effective status for the requested date range. */
  summary: AttendanceSummary;
  loading: boolean;
  error: string | null;

  fetchMyRecords: (params?: AttendanceFilters) => Promise<void>;
  accessUnavailable: boolean;
  reset: () => void;
}

export const useEmployeeAttendanceStore = create<EmployeeAttendanceState>(
  (set) => ({
    records: [],
    total: 0,
    summary: {},
    loading: false,
    error: null,
    accessUnavailable: false,

    reset: () =>
      set({
        records: [],
        total: 0,
        summary: {},
        loading: false,
        error: null,
        accessUnavailable: false,
      }),

    fetchMyRecords: async (params) => {
      // Keep the current rows on screen while the next range loads; they are
      // cleared only when the request fails.
      set({
        loading: true,
        error: null,
        accessUnavailable: false,
      });
      try {
        const response = await getMyAttendance(params);
        const data = unwrapEnvelope(response);
        const { items, total } = normalizeListData<AttendanceRecord>(data);
        const summary: AttendanceSummary =
          (data?.effective_summary as AttendanceSummary | undefined) ||
          (data?.summary as AttendanceSummary | undefined) ||
          {};
        set({ records: items, total, summary, loading: false });
      } catch (err: any) {
        if (
          err.response?.status === 403 &&
          err.response?.data?.message ===
            "Attendance is unavailable until your BioTime mapping is completed. Contact HR to be registered on a BioTime device."
        ) {
          set({
            records: [],
            total: 0,
            summary: {},
            loading: false,
            error: null,
            accessUnavailable: true,
          });
          return;
        }
        const msg =
          err.response?.data?.message ||
          err.message ||
          "Failed to fetch attendance";
        set({ records: [], total: 0, summary: {}, loading: false, error: msg });
      }
    },
  }),
);
