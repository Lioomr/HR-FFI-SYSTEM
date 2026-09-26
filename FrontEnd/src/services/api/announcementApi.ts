import { api } from "./apiClient";

export interface Announcement {
  id: number;
  company_id?: number;
  company_name?: string;
  /** Set when sent from Main Head Office: one copy per company, same id. */
  broadcast_id?: string | null;
  /** Companies a Main Head Office broadcast reached. Empty otherwise. */
  broadcast_company_names?: string[];
  /** Employees a broadcast was sent to one by one; 0 for whole companies. */
  broadcast_recipient_count?: number;
  title: string;
  content: string;
  announcement_type: "GENERAL" | "MEETING";
  whole_company?: boolean;
  whatsapp_group_id?: string;
  whatsapp_group_name?: string;
  whatsapp_group_status?: string;
  target_roles: string[];
  target_user?: number | null;
  target_user_email?: string | null;
  publish_to_dashboard: boolean;
  publish_to_email: boolean;
  /** Preferred WhatsApp delivery flag (delivery goes through WhatsApp/Evolution). */
  publish_to_whatsapp?: boolean;
  /** @deprecated compatibility alias for publish_to_whatsapp. */
  publish_to_sms?: boolean;
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
  /** Set when sent from Main Head Office: one copy per company, same id. */
  broadcast_id?: string | null;
  /** Companies a Main Head Office broadcast reached. Empty otherwise. */
  broadcast_company_names?: string[];
  /** Employees a broadcast was sent to one by one; 0 for whole companies. */
  broadcast_recipient_count?: number;
  title: string;
  content_preview: string;
  announcement_type: "GENERAL" | "MEETING";
  whole_company?: boolean;
  whatsapp_group_id?: string;
  whatsapp_group_name?: string;
  whatsapp_group_status?: string;
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

/** Every company, chosen companies, or chosen employees from any company. */
export type HeadOfficeAudience = "ALL_COMPANIES" | "COMPANIES" | "EMPLOYEES";

/** An active employee HR can pick; Main Head Office lists every company. */
export interface AnnouncementRecipientCandidate {
  user_id: number;
  employee_id: string;
  full_name: string;
  full_name_en?: string | null;
  full_name_ar?: string | null;
  company_id: number;
  company_name: string;
}

export interface CreateAnnouncementData {
  title: string;
  content: string;
  announcement_type?: "GENERAL" | "MEETING";
  whole_company?: boolean;
  whatsapp_group_id?: string;
  target_roles?: "CEO"[];
  target_user?: number;
  target_user_ids?: number[];
  /** Main Head Office only: who receives the announcement. */
  broadcast_audience?: HeadOfficeAudience;
  /** Main Head Office only, with the COMPANIES audience. */
  company_ids?: number[];
  publish_to_dashboard: boolean;
  publish_to_email: boolean;
  /** Preferred WhatsApp delivery flag (delivery goes through WhatsApp/Evolution). */
  publish_to_whatsapp?: boolean;
  /** @deprecated compatibility alias for publish_to_whatsapp. */
  publish_to_sms?: boolean;
  meeting_starts_at?: string | null;
  meeting_duration_minutes?: number | null;
  meeting_location?: string;
  meeting_agenda?: string;
  google_meet_url?: string;
  microsoft_teams_url?: string;
  zoom_url?: string;
  attachment?: File | null;
}

function toAnnouncementFormData(data: Partial<CreateAnnouncementData>) {
  const formData = new FormData();
  if (data.title !== undefined) formData.append("title", data.title);
  if (data.content !== undefined) formData.append("content", data.content);
  if (data.announcement_type !== undefined)
    formData.append("announcement_type", data.announcement_type);
  if (data.whatsapp_group_id !== undefined)
    formData.append("whatsapp_group_id", data.whatsapp_group_id);
  if (data.whole_company !== undefined)
    formData.append("whole_company", String(data.whole_company));
  if (data.target_roles !== undefined)
    formData.append("target_roles", JSON.stringify(data.target_roles));
  if (data.target_user !== undefined)
    formData.append("target_user", String(data.target_user));
  if (data.target_user_ids?.length) {
    data.target_user_ids.forEach((id) =>
      formData.append("target_user_ids", String(id)),
    );
  }
  if (data.broadcast_audience !== undefined)
    formData.append("broadcast_audience", data.broadcast_audience);
  data.company_ids?.forEach((id) => formData.append("company_ids", String(id)));
  if (data.publish_to_dashboard !== undefined) {
    formData.append("publish_to_dashboard", String(data.publish_to_dashboard));
  }
  if (data.publish_to_email !== undefined) {
    formData.append("publish_to_email", String(data.publish_to_email));
  }
  if (data.publish_to_whatsapp !== undefined) {
    formData.append("publish_to_whatsapp", String(data.publish_to_whatsapp));
  }
  if (data.publish_to_sms !== undefined) {
    formData.append("publish_to_sms", String(data.publish_to_sms));
  }
  if (data.meeting_starts_at)
    formData.append("meeting_starts_at", data.meeting_starts_at);
  if (data.meeting_duration_minutes != null) {
    formData.append(
      "meeting_duration_minutes",
      String(data.meeting_duration_minutes),
    );
  }
  if (data.meeting_location !== undefined)
    formData.append("meeting_location", data.meeting_location);
  if (data.meeting_agenda !== undefined)
    formData.append("meeting_agenda", data.meeting_agenda);
  if (data.google_meet_url !== undefined)
    formData.append("google_meet_url", data.google_meet_url);
  if (data.microsoft_teams_url !== undefined) {
    formData.append("microsoft_teams_url", data.microsoft_teams_url);
  }
  if (data.zoom_url !== undefined) formData.append("zoom_url", data.zoom_url);
  if (data.attachment) {
    formData.append("attachment", data.attachment);
  }
  return formData;
}

/**
 * Get announcements for the current user (filtered by role)
 */
export async function getAnnouncements(page = 1, pageSize = 10) {
  const response = await api.get("/api/announcements", {
    params: { page, page_size: pageSize },
  });
  return response.data;
}

/**
 * Get all announcements (HR managers only)
 */
export async function getAllAnnouncements(page = 1, pageSize = 10) {
  const response = await api.get("/api/announcements", {
    params: { page, page_size: pageSize },
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
  const formData = toAnnouncementFormData({
    ...data,
    announcement_type: data.announcement_type || "GENERAL",
    target_roles: data.target_roles || [],
  });

  const response = await api.post("/api/announcements", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
}

/**
 * Update an existing announcement (HR managers only)
 */
export async function updateAnnouncement(
  id: number,
  data: Partial<CreateAnnouncementData>,
) {
  const response = await api.patch(
    `/api/announcements/${id}`,
    toAnnouncementFormData(data),
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );
  return response.data;
}

export async function getAnnouncementAttachment(
  id: number,
  download = false,
): Promise<Blob> {
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

export interface AnnouncementWhatsAppGroup {
  id: string;
  name: string;
}

export async function getAnnouncementRecipientCandidates(): Promise<
  AnnouncementRecipientCandidate[]
> {
  const response = await api.get("/api/announcements/recipient-candidates");
  return response.data.data.items;
}

export async function getAnnouncementWhatsAppGroups(): Promise<{
  state: string;
  groups: AnnouncementWhatsAppGroup[];
}> {
  const response = await api.get("/api/announcements/whatsapp-groups");
  return response.data.data;
}
