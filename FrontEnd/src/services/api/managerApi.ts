
import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

// -- Leave Requests --

export type ManagerLeaveRequest = {
    id: number;
    employee: {
        id: number;
        email: string;
        full_name: string;
    };
    leave_type: {
        id: number;
        name: string;
        code: string;
    };
    start_date: string;
    end_date: string;
    days?: number;
    reason: string;
    document?: string | null;
    status: string;
    created_at: string;
};

export async function getManagerLeaveRequests(status?: string) {
    const params = status ? { status } : {};
    const { data } = await api.get<ApiResponse<any>>("/api/leaves/manager/leave-requests/", { params });
    if (data?.status === "success" && data?.data?.items) {
        return { ...data, data: data.data.items as ManagerLeaveRequest[] } as ApiResponse<ManagerLeaveRequest[]>;
    }
    if (Array.isArray((data as any)?.results)) {
        return { status: "success", data: (data as any).results } as ApiResponse<ManagerLeaveRequest[]>;
    }
    if (Array.isArray(data)) {
        return { status: "success", data: data as ManagerLeaveRequest[] } as ApiResponse<ManagerLeaveRequest[]>;
    }
    return data as ApiResponse<ManagerLeaveRequest[]>;
}

export async function getManagerLeaveRequest(id: number | string) {
    const { data } = await api.get<any>(`/api/leaves/manager/leave-requests/${id}/`);
    if (data?.status === "success") {
        return data as ApiResponse<ManagerLeaveRequest>;
    }
    if (data?.id) {
        return { status: "success", data: data as ManagerLeaveRequest } as ApiResponse<ManagerLeaveRequest>;
    }
    return data as ApiResponse<ManagerLeaveRequest>;
}

export async function getManagerLeaveRequestDocumentBlob(
    id: number | string,
    download = false
) {
    const { data } = await api.get(`/api/leaves/manager/leave-requests/${id}/document/`, {
        params: download ? { download: 1 } : undefined,
        responseType: "blob",
    });
    return data as Blob;
}

export async function approveLeaveRequestManager(id: number, comment?: string) {
    const { data } = await api.post<ApiResponse<any>>(`/api/leaves/manager/leave-requests/${id}/approve/`, { comment });
    return data;
}

export async function rejectLeaveRequestManager(id: number, comment: string) {
    const { data } = await api.post<ApiResponse<any>>(`/api/leaves/manager/leave-requests/${id}/reject/`, { comment });
    return data;
}

// -- Attendance Requests --

export type ManagerAttendanceRecord = {
    id: number;
    employee_profile: {
        id: number;
        user: {
            id: number;
            email: string;
            full_name: string;
        };
    };
    date: string;
    check_in_at: string | null;
    check_out_at: string | null;
    status: string;
    source: string;
    created_at: string;
};

export type ManagerTeamMember = {
    id: number;
    user_id?: number;
    employee_id: string;
    full_name?: string;
    full_name_en?: string;
    full_name_ar?: string;
    email?: string;
    mobile?: string;
    department?: string;
    position?: string;
    manager_name?: string;
};

export async function getManagerAttendance(status?: string) {
    const params = status ? { status } : {};
    const { data } = await api.get<ApiResponse<any>>("/api/manager/attendance/", { params });
    if (data?.status === "success" && data?.data?.items) {
        return { ...data, data: data.data.items as ManagerAttendanceRecord[] } as ApiResponse<ManagerAttendanceRecord[]>;
    }
    if (Array.isArray((data as any)?.results)) {
        return { status: "success", data: (data as any).results } as ApiResponse<ManagerAttendanceRecord[]>;
    }
    if (Array.isArray(data)) {
        return { status: "success", data: data as ManagerAttendanceRecord[] } as ApiResponse<ManagerAttendanceRecord[]>;
    }
    return data as ApiResponse<ManagerAttendanceRecord[]>;
}

export async function approveAttendanceManager(id: number, notes?: string) {
    const { data } = await api.post<ApiResponse<any>>(`/api/manager/attendance/${id}/approve/`, { notes });
    return data;
}

export async function rejectAttendanceManager(id: number, notes: string) {
    const { data } = await api.post<ApiResponse<any>>(`/api/manager/attendance/${id}/reject/`, { notes });
    return data;
}

export async function getManagerTeam(search?: string) {
    const params = search ? { search } : {};
    const { data } = await api.get<ApiResponse<any>>("/employees/manager/team", { params });
    if (data?.status === "success" && Array.isArray((data as any)?.data?.results)) {
        return { status: "success", data: (data as any).data.results as ManagerTeamMember[] } as ApiResponse<ManagerTeamMember[]>;
    }
    if (data?.status === "success" && Array.isArray((data as any)?.data?.items)) {
        return { status: "success", data: (data as any).data.items as ManagerTeamMember[] } as ApiResponse<ManagerTeamMember[]>;
    }
    if (Array.isArray((data as any)?.results)) {
        return { status: "success", data: (data as any).results as ManagerTeamMember[] } as ApiResponse<ManagerTeamMember[]>;
    }
    if (Array.isArray(data)) {
        return { status: "success", data: data as ManagerTeamMember[] } as ApiResponse<ManagerTeamMember[]>;
    }
    return data as ApiResponse<ManagerTeamMember[]>;
}
