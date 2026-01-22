import { create } from "zustand";
import type { AttendanceRecord, AttendanceFilters } from "../types/attendance";
import {
  getMyAttendance,
  checkIn,
  checkOut,
  getGlobalAttendance,
  overrideAttendance,
} from "../services/api/attendanceApi";
import { unwrapEnvelope, normalizeListData } from "../utils/dataUtils";

interface EmployeeAttendanceState {
  records: AttendanceRecord[];
  total: number;
  loading: boolean;
  error: string | null;
  
  fetchMyRecords: (params?: AttendanceFilters) => Promise<void>;
  performCheckIn: () => Promise<void>;
  performCheckOut: () => Promise<void>;
}

export const useEmployeeAttendanceStore = create<EmployeeAttendanceState>((set, get) => ({
  records: [],
  total: 0,
  loading: false,
  error: null,

  fetchMyRecords: async (params) => {
    set({ loading: true, error: null });
    try {
      const response = await getMyAttendance(params);
      const data = unwrapEnvelope(response);
      const { items, total } = normalizeListData<AttendanceRecord>(data);
      set({ records: items, total, loading: false });
    } catch (err: any) {
       const msg = err.response?.data?.message || err.message || "Failed to fetch attendance";
      set({ loading: false, error: msg });
    }
  },

  performCheckIn: async () => {
    set({ loading: true, error: null });
    try {
      const response = await checkIn();
      unwrapEnvelope(response);
      set({ loading: false });
      // Refresh list
      await get().fetchMyRecords({});
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Check-in failed";
      set({ loading: false, error: msg });
      throw err;
    }
  },

  performCheckOut: async () => {
    set({ loading: true, error: null });
    try {
      const response = await checkOut();
      unwrapEnvelope(response);
      set({ loading: false });
      // Refresh list
      await get().fetchMyRecords({});
    } catch (err: any) {
       const msg = err.response?.data?.message || err.message || "Check-out failed";
      set({ loading: false, error: msg });
      throw err;
    }
  },
}));

interface HrAttendanceState {
  records: AttendanceRecord[];
  total: number;
  loading: boolean;
  error: string | null;

  fetchGlobalRecords: (params?: AttendanceFilters) => Promise<void>;
  performOverride: (id: string | number, data: any) => Promise<void>;
}

export const useHrAttendanceStore = create<HrAttendanceState>((set) => ({
  records: [],
  total: 0,
  loading: false,
  error: null,

  fetchGlobalRecords: async (params) => {
    set({ loading: true, error: null });
    try {
      const response = await getGlobalAttendance(params);
      const data = unwrapEnvelope(response);
      const { items, total } = normalizeListData<AttendanceRecord>(data);
      set({ records: items, total, loading: false });
    } catch (err: any) {
      // Prioritize explicit error message from unwrap or backend envelope
      const msg = err.response?.data?.message || err.message || "Failed to fetch records";
      set({ loading: false, error: msg });
    }
  },

  performOverride: async (id, data) => {
    set({ loading: true, error: null });
    try {
      const response = await overrideAttendance(id, data);
      unwrapEnvelope(response); // Verify success status
      set({ loading: false });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Override failed";
      set({ loading: false, error: msg });
      throw err;
    }
  },
}));
