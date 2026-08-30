export interface OrganizationSummary {
  id: string | number;
  name: string;
  code?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  /** Raw wire value; narrow it with `normalizeRole` from `./role` before branching. */
  role: string;
  is_active?: boolean;
  date_joined?: string;
  accessible_organizations: OrganizationSummary[];
  default_organization_id: string | number | null;
  has_all_company_access: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
