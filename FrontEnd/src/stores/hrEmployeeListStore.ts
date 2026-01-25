import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Filter state for employee list
 */
interface EmployeeListFilters {
  department?: string;
  position?: string;
  task_group?: string;
  sponsor?: string;
  status?: string;
}

/**
 * State for HR Employee List page
 * Persisted to survive navigation
 */
interface HrEmployeeListState {
  // Search and filters
  search: string;
  filters: EmployeeListFilters;
  
  // Pagination
  page: number;
  pageSize: number;
  
  // Actions
  setSearch: (search: string) => void;
  setFilters: (filters: Partial<EmployeeListFilters>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  reset: () => void;
}

/**
 * Initial state
 */
const initialState = {
  search: "",
  filters: {},
  page: 1,
  pageSize: 25,
};

/**
 * Zustand store for HR Employee List page state
 * Uses persist middleware to maintain state across navigation
 */
export const useHrEmployeeListStore = create<HrEmployeeListState>()(
  persist(
    (set) => ({
      ...initialState,
      
      setSearch: (search: string) => set({ search, page: 1 }),
      
      setFilters: (newFilters: Partial<EmployeeListFilters>) =>
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
          page: 1, // Reset to page 1 when filters change
        })),
      
      setPage: (page: number) => set({ page }),
      
      setPageSize: (pageSize: number) => set({ pageSize, page: 1 }),
      
      reset: () => set(initialState),
    }),
    {
      name: "hr-employee-list-storage", // localStorage key
    }
  )
);
