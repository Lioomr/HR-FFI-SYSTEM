import { api } from './apiClient';

export interface Announcement {
    id: number;
    title: string;
    content: string;
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
    created_by: number;
    created_by_name: string;
    created_at: string;
    updated_at: string;
    is_active: boolean;
}

export interface AnnouncementListItem {
    id: number;
    title: string;
    content_preview: string;
    target_roles: string[];
    target_user?: number | null;
    target_user_email?: string | null;
    attachment_name?: string | null;
    has_attachment?: boolean;
    created_by_name: string;
    created_at: string;
    is_active: boolean;
}

export interface CreateAnnouncementData {
    title: string;
    content: string;
    target_roles: string[];
    target_user?: number;
    publish_to_dashboard: boolean;
    publish_to_email: boolean;
    publish_to_sms: boolean;
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
    formData.append("target_roles", JSON.stringify(data.target_roles));
    if (data.target_user !== undefined) {
        formData.append("target_user", String(data.target_user));
    }
    formData.append("publish_to_dashboard", String(data.publish_to_dashboard));
    formData.append("publish_to_email", String(data.publish_to_email));
    formData.append("publish_to_sms", String(data.publish_to_sms));
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
        params: download ? { download: 1 } : undefined,
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
