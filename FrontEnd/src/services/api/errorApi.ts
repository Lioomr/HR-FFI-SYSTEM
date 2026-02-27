import { api } from "./apiClient";

/**
 * Report an unhandled error to the system administrators.
 */
export async function reportErrorApi(data: { message: string; stack: string; url: string }) {
    return await api.post("/api/core/report-error/", data);
}
