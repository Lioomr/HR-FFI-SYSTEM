import type { AuthUser } from "../auth/authStore";
import type { OrganizationNodeDto } from "../services/api/apiTypes";

export function getActiveOrganization(
  user?: AuthUser | null,
): OrganizationNodeDto | null {
  if (!user) return null;
  const organizations = user.accessible_organizations ?? [];
  const activeOrganizationId =
    user.active_organization_id ?? user.default_organization_id ?? null;
  return (
    organizations.find(
      (organization) =>
        String(organization.id) === String(activeOrganizationId),
    ) ?? null
  );
}

export function isHeadOfficeOrganization(user?: AuthUser | null): boolean {
  return getActiveOrganization(user)?.node_type === "head_office";
}

/**
 * Pages that still work while Main Head Office is selected. The backend
 * scopes company-owned data (employees, leave, job offers, ...) to exactly one
 * company and answers 403 in head-office context by design, so every other
 * page shows a company picker instead of loading.
 */
// Root redirects: exact match only, so their sub-pages are not let through.
const HEAD_OFFICE_REDIRECT_PATHS = ["/", "/admin"];
const HEAD_OFFICE_PATHS = [
  "/admin/dashboard",
  "/admin/users",
  "/admin/audit-logs",
  "/admin/settings",
  "/admin/biotime",
  "/admin/whatsapp",
  "/admin/profile",
  "/hr/templates",
  "/hr/activity",
  "/hr/profile",
  "/ceo/profile",
  "/cfo/profile",
  "/manager/profile",
  "/employee/profile",
  "/change-password",
];

export function pageNeedsCompany(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (HEAD_OFFICE_REDIRECT_PATHS.includes(path)) return false;
  return !HEAD_OFFICE_PATHS.some(
    (allowed) => path === allowed || path.startsWith(`${allowed}/`),
  );
}
