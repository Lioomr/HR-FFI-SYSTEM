export type ApiSuccess<T> = {
  status: "success";
  data: T;
  message?: string;
};

export type ApiError = {
  status: "error";
  message: string;
  errors?: Record<string, string[]>;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return res.status === "error";
}

export type Role = "SystemAdmin" | "HRManager" | "Employee";

export type PaginatedResponse<T> = {
  items: T[];
  page?: number;
  page_size?: number;
  count?: number;
  total_pages?: number;
};

export type AdminSummary = {
  users: {
    total: number;
    active: number;
    inactive: number;
  };
  invites: {
    total: number;
    sent: number;
    expired: number;
    revoked: number;
    accepted: number;
  };
  audit: {
    today: number;
    last_7_days: number;
    top_actions_today?: { action: string; count: number }[];
  };
  server_time: string;
};

export type UserDto = {
  id: number | string;
  full_name: string;
  email: string;
  is_active: boolean;
  role: Role;
  is_staff?: boolean;
  is_superuser?: boolean;
};

export type InviteDto = {
  id: number | string;
  email: string;
  role: Role;
  status: string;
  sent_at: string | null;
  expires_at: string | null;
  resend_count: number;
  last_resent_at: string | null;
};

export type AuditLogDto = {
  id: number | string;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string;
  ip_address: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export type SettingsDto = {
  password_policy: {
    min_length: number;
    require_upper: boolean;
    require_lower: boolean;
    require_number: boolean;
    require_special: boolean;
  };
  session: {
    timeout_minutes: number;
  };
  invites: {
    default_expiry_hours: number;
  };
  security: {
    max_login_attempts: number;
  };
  updated_at: string;
};
