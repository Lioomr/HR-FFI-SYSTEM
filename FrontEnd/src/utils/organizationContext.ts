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

/** Query parameter that notification links use to name their request's company. */
export const LINK_COMPANY_PARAM = "company";

// Forms never switch company, so a crafted link cannot move one to another company.
const FORM_PAGE = /\/(new|create|edit)(\/|$)/;

export type CompanyLinkResolution = {
  /** Company to select before the page loads; null keeps the current one. */
  switchTo: OrganizationNodeDto | null;
  /** The same location without the company parameter. */
  cleanPath: string;
};

/**
 * Reads the `?company=` hint on notification links (WhatsApp, email, bell) so
 * the request opens in its own company. It is only a hint: it selects a company
 * the user can already access, and the API still checks access on every call.
 * Returns null when the location has no hint.
 */
export function resolveCompanyLink(
  location: { pathname: string; search: string; hash: string },
  user?: AuthUser | null,
): CompanyLinkResolution | null {
  const params = new URLSearchParams(location.search);
  if (!params.has(LINK_COMPANY_PARAM)) return null;
  const values = params.getAll(LINK_COMPANY_PARAM);
  params.delete(LINK_COMPANY_PARAM);
  const query = params.toString();
  const cleanPath = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;

  const requestedId =
    values.length === 1 && /^\d+$/.test(values[0]) ? values[0] : null;
  const target =
    requestedId && !FORM_PAGE.test(location.pathname)
      ? (user?.accessible_organizations ?? []).find(
          (organization) =>
            organization.node_type === "company" &&
            String(organization.id) === requestedId,
        )
      : undefined;
  const isActive =
    target && String(target.id) === String(getActiveOrganization(user)?.id);
  return { switchTo: target && !isActive ? target : null, cleanPath };
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
  // Announcements sent from Main Head Office go to every company.
  "/hr/announcements",
  "/ceo/announcements",
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
