/**
 * API error item - can be an object with field/message/code or a simple string
 */
export type ApiErrorItem =
  | { field?: string; message: string; code?: string }
  | string;

/**
 * Successful API response envelope
 */
export type ApiSuccess<T> = {
  status: "success";
  data: T;
  message?: string;
};

/**
 * Error API response envelope (Global API Rules v1)
 * errors is contractually an array, not an object map
 */
export type ApiError = {
  status: "error";
  message: string;
  errors?: ApiErrorItem[];
};

/**
 * Union type for all API responses
 */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/**
 * Type guard to check if an API response is an error
 */
export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return res.status === "error";
}

export type Role =
  | "SystemAdmin"
  | "HRManager"
  | "Manager"
  | "Employee"
  | "CEO"
  | "CFO";

export type OrganizationNodeDto = {
  id: number | string;
  code: string;
  name: string;
  node_type: "head_office" | "company";
  parent_id: number | string | null;
  employee_id_prefix?: string;
  is_active: boolean;
};

// Confirmed delivery state reported by the provider/back-end.
// "sent" here means submitted to the provider, NOT confirmed delivery.
export type InviteDeliveryStatus =
  | "unknown"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type EmailDeliveryStatus = {
  sent: boolean;
  provider: string;
  provider_submitted?: boolean | null;
  provider_status?: string | null;
  delivery_status?: InviteDeliveryStatus | null;
  status_code?: number | null;
  message_id?: string | null;
  error?: string | null;
};

export type LastDeliveryStatus = {
  channel?: string | null;
  sent: boolean;
  provider?: string | null;
  provider_submitted?: boolean | null;
  provider_status?: string | null;
  delivery_status?: InviteDeliveryStatus | null;
  status_code?: number | null;
  message_id?: string | null;
  error?: string | null;
  attempted_at?: string | null;
};

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
    total_growth_pct: number;
    active_growth_pct: number;
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
  /** Display names per language (from the employee profile when linked). */
  full_name_en?: string | null;
  full_name_ar?: string | null;
  email: string;
  is_active: boolean;
  role: Role;
  accessible_organizations?: OrganizationNodeDto[];
  default_organization_id?: number | string | null;
  has_all_company_access?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
};

export type InviteDto = {
  id: number | string;
  email: string | null;
  phone_number?: string | null;
  channel?: string;
  role: Role;
  status: string;
  sent_at: string | null;
  expires_at: string | null;
  resend_count: number;
  last_resent_at: string | null;
  email_delivery?: EmailDeliveryStatus;
  whatsapp_delivery?: EmailDeliveryStatus;
  last_delivery?: LastDeliveryStatus;
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
  /**
   * Mirrors `admin_portal.serializers_settings.AttendanceSettingsSerializer`.
   * Always present on GET; optional on PUT, where omitting it preserves the
   * stored values for legacy settings clients. On PUT `geofence_enabled` stays
   * required whenever `attendance` is sent; the work-schedule keys are optional
   * and omitting one leaves it unchanged.
   */
  attendance?: AttendancePolicySettings;
  updated_at: string;
};

/**
 * The global attendance policy (one singleton, not per company). HR Manager
 * and System Admin may PUT it alone as `{ attendance: {...} }`.
 */
export type AttendancePolicySettings = {
  geofence_enabled?: boolean;
  /** "HH:MM" (24h) shift start. */
  work_day_start_time?: string;
  /** "HH:MM" (24h) shift end used when an employee has no shift of their own. */
  default_shift_end_time?: string;
  /** Canonical grace window after shift start, in minutes (0–240). */
  grace_window_minutes?: number;
  /**
   * @deprecated Legacy alias of `grace_window_minutes`, kept in responses.
   * Do not send it; the server keeps both synchronized.
   */
  late_grace_minutes?: number;
  /**
   * Once the month's 3rd late violation withdraws the grace window, minutes
   * still treated as on time (0–240).
   */
  post_grace_tolerance_minutes?: number;
  /** Final-approved Late Permissions allowed per month (0–31). */
  approved_late_permission_limit_per_month?: number;
  /** Longest During Shift permission, in minutes (1–1440). */
  during_shift_permission_max_minutes?: number;
  /** How many days ahead Late and During Shift requests may be dated (0–365). */
  permission_request_advance_limit_days?: number;
  /** When true, a daily job marks Absent anyone with no record and no approved leave. */
  absence_detection_enabled?: boolean;
};

/**
 * Mirrors `Backend/leaves/serializers.py::LeaveBalanceSerializer`.
 * DRF serialises decimals as strings, so numeric fields accept both shapes.
 */
export type LeaveBalance = {
  leave_type_id: number;
  leave_type: string;
  leave_code?: string;
  total_days: number | string;
  used_days: number | string;
  remaining_days: number | string;
  /** Whole days already reserved by submitted/pending requests. */
  pending_days?: number | string;
  /** The only figure an employee may request against: floor(remaining) - pending. */
  requestable_days?: number | string;
  /** Sub-day remainder of the balance; informational, never requestable. */
  fractional_days?: number | string;
  adjustments?: number | string;
  available_annual_year_days?: number | string;
};
