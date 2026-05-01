import { api } from './apiClient';

export interface Announcement {
    id: number;
    company_id?: number;
    company_name?: string;
    title: string;
    content: string;
    announcement_type: "GENERAL" | "MEETING";
    target_roles: string[];
    target_user?: number | null;
    target_user_email?: string | null;
    publish_to_dashboard: boolean;
    publish_to_email: boolean;
    publish_to_sms: boolean;
    attachment?: string | null;
    attachment_name?: string | null;
    attachment_size?: number | null;
    has_attachment?: boolean;
    meeting_starts_at?: string | null;
    meeting_duration_minutes?: number | null;
    meeting_location?: string;
    meeting_agenda?: string;
    google_meet_url?: string;
    microsoft_teams_url?: string;
    zoom_url?: string;
    created_by: number;
    created_by_name: string;
    created_at: string;
    updated_at: string;
    is_active: boolean;
}

export interface AnnouncementListItem {
    id: number;
    company_id?: number;
    company_name?: string;
    title: string;
    content_preview: string;
    announcement_type: "GENERAL" | "MEETING";
    target_roles: string[];
    target_user?: number | null;
    target_user_email?: string | null;
    meeting_starts_at?: string | null;
    meeting_duration_minutes?: number | null;
    meeting_location?: string;
    meeting_agenda?: string;
    google_meet_url?: string;
    microsoft_teams_url?: string;
    zoom_url?: string;
    attachment_name?: string | null;
    has_attachment?: boolean;
    created_by_name: string;
    created_at: string;
    is_active: boolean;
}

export interface CreateAnnouncementData {
    title: string;
    content: string;
    announcement_type?: "GENERAL" | "MEETING";
    target_roles: string[];
    target_user?: number;
    target_user_ids?: number[];
    publish_to_dashboard: boolean;
    publish_to_email: boolean;
    publish_to_sms: boolean;
    meeting_starts_at?: string | null;
    meeting_duration_minutes?: number | null;
    meeting_location?: string;
    meeting_agenda?: string;
    google_meet_url?: string;
    microsoft_teams_url?: string;
    zoom_url?: string;
    attachment?: File | null;
}

/**
 * Get announcements for the current user (filtered by role)
 */
export async function getAnnouncements(page = 1, pageSize = 10) {
    const response = await api.get('/api/announcements', {
        params: { page, page_size: pageSize }
    });
    return response.data;
}

/**
 * Get all announcements (HR managers only)
 */
export async function getAllAnnouncements(page = 1, pageSize = 10) {
    const response = await api.get('/api/announcements', {
        params: { page, page_size: pageSize }
    });
    return response.data;
}

/**
 * Get a single announcement by ID
 */
export async function getAnnouncement(id: number) {
    const response = await api.get(`/api/announcements/${id}`);
    return response.data;
}

/**
 * Create a new announcement (HR managers only)
 */
export async function createAnnouncement(data: CreateAnnouncementData) {
    const formData = new FormData();
    formData.append("title", data.title);
    formData.append("content", data.content);
    formData.append("announcement_type", data.announcement_type || "GENERAL");
    formData.append("target_roles", JSON.stringify(data.target_roles));
    if (data.target_user !== undefined) {
        formData.append("target_user", String(data.target_user));
    }
    if (data.target_user_ids?.length) {
        data.target_user_ids.forEach((id) => formData.append("target_user_ids", String(id)));
    }
    formData.append("publish_to_dashboard", String(data.publish_to_dashboard));
    formData.append("publish_to_email", String(data.publish_to_email));
    formData.append("publish_to_sms", String(data.publish_to_sms));
    if (data.meeting_starts_at) formData.append("meeting_starts_at", data.meeting_starts_at);
    if (data.meeting_duration_minutes != null) formData.append("meeting_duration_minutes", String(data.meeting_duration_minutes));
    if (data.meeting_location) formData.append("meeting_location", data.meeting_location);
    if (data.meeting_agenda) formData.append("meeting_agenda", data.meeting_agenda);
    if (data.google_meet_url) formData.append("google_meet_url", data.google_meet_url);
    if (data.microsoft_teams_url) formData.append("microsoft_teams_url", data.microsoft_teams_url);
    if (data.zoom_url) formData.append("zoom_url", data.zoom_url);
    if (data.attachment) {
        formData.append("attachment", data.attachment);
    }

    const response = await api.post('/api/announcements', formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });
    return response.data;
}

/**
 * Update an existing announcement (HR managers only)
 */
export async function updateAnnouncement(id: number, data: Partial<CreateAnnouncementData>) {
    const response = await api.patch(`/api/announcements/${id}`, data);
    return response.data;
}

export async function getAnnouncementAttachment(id: number, download = false): Promise<Blob> {
    const response = await api.get(`/api/announcements/${id}/attachment`, {
        // Backend defaults to Content-Disposition: attachment. Send `download=0`
        // explicitly when previewing so the response is returned inline.
        params: { download: download ? 1 : 0 },
        responseType: "blob",
    });
    return response.data;
}

/**
 * Delete an announcement (HR managers only - soft delete)
 */
export async function deleteAnnouncement(id: number) {
    const response = await api.delete(`/api/announcements/${id}`);
    return response.data;
}
