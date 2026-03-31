import { api } from "./apiClient";

export interface BioTimeConfig {
    server_ip: string;
    server_port: string;
    username: string;
    password?: string; // Optional since we don't always get it back
    is_active: boolean;
    last_sync_time?: string;
}

export interface BioTimeEmployeeMap {
    id: number;
    employee_profile: number;
    employee_name: string;
    department: string;
    biotime_emp_code: string;
    created_at: string;
}

export interface UnmappedBioTimeUser {
    emp_code: string;
    first_name: string;
    last_name: string;
    department: string;
}

export const bioTimeApi = {
    // Config
    getConfig: () => api.get<BioTimeConfig>("/api/biotime/config/").then((res: any) => res.data),
    updateConfig: (data: Partial<BioTimeConfig>) => api.put<BioTimeConfig>("/api/biotime/config/", data).then((res: any) => res.data),
    
    // Actions
    testConnection: (data: Partial<BioTimeConfig>) => api.post("/api/biotime/actions/test-connection/", data).then((res: any) => res.data),
    syncNow: () => api.post("/api/biotime/actions/sync-now/").then((res: any) => res.data),
    
    // Mappings
    getMappings: () => api.get<any>("/api/biotime-mappings/").then((res: any) => res.data as any).then((res: any) => res.results || res),
    createMapping: (data: Partial<BioTimeEmployeeMap>) => api.post<BioTimeEmployeeMap>("/api/biotime-mappings/", data).then((res: any) => res.data),
    deleteMapping: (id: number) => api.delete(`/api/biotime-mappings/${id}/`),
    getUnmappedUsers: () => api.get<UnmappedBioTimeUser[]>("/api/biotime-mappings/unmapped/").then((res: any) => res.data),
};
