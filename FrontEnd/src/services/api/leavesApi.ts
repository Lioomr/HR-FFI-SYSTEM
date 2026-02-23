import { api as apiClient } from "./apiClient";
import type { ApiResponse, LeaveBalance } from "./apiTypes";

const leavesApi = {
  /**
   * Get my own leave balances for a specific year
   */
  getMyBalances: async (year: number): Promise<ApiResponse<LeaveBalance[]>> => {
    const response = await apiClient.get<ApiResponse<LeaveBalance[]>>(
      `/api/leaves/employee/leave-balance/?year=${year}`
    );
    return response.data;
  },

  /**
   * Get any employee's leave balances (HR/Admin only)
   */
  getEmployeeBalances: async (
    employeeId: number | string,
    year: number
  ): Promise<ApiResponse<LeaveBalance[]>> => {
    const response = await apiClient.get<ApiResponse<LeaveBalance[]>>(
      `/api/leaves/leave-balances/?employee_id=${employeeId}&year=${year}`
    );
    return response.data;
  },

  /**
   * Create a new leave request
   */
  createLeaveRequest: async (data: {
    leave_type: number;
    start_date: string;
    end_date: string;
    reason?: string;
    document?: File;
  } | FormData): Promise<ApiResponse<any>> => {
    const config = data instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : undefined;
    const response = await apiClient.post<ApiResponse<any>>(
      `/api/leaves/leave-requests/`,
      data,
      config
    );
    return response.data;
  },
};

export default leavesApi;
