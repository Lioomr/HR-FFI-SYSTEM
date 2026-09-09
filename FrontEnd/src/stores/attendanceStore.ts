import { create } from "zustand";
import type { AttendanceRecord, AttendanceFilters } from "../types/attendance";
import { getMyAttendance } from "../services/api/attendanceApi";
import { unwrapEnvelope, normalizeListData } from "../utils/dataUtils";

interface EmployeeAttendanceState {
  records: AttendanceRecord[];
  total: number;
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
    loading: false,
    error: null,
    accessUnavailable: false,

    reset: () =>
      set({
        records: [],
        total: 0,
        loading: false,
        error: null,
        accessUnavailable: false,
      }),

    fetchMyRecords: async (params) => {
      set({
        records: [],
        total: 0,
        loading: true,
        error: null,
        accessUnavailable: false,
      });
      try {
        const response = await getMyAttendance(params);
        const data = unwrapEnvelope(response);
        const { items, total } = normalizeListData<AttendanceRecord>(data);
        set({ records: items, total, loading: false });
      } catch (err: any) {
        if (
          err.response?.status === 403 &&
          err.response?.data?.message ===
            "Attendance is unavailable until your BioTime mapping is completed. Contact HR to be registered on a BioTime device."
        ) {
          set({
            records: [],
            total: 0,
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
        set({ loading: false, error: msg });
      }
    },
  }),
);
