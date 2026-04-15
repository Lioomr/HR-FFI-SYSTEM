import type { AuthUser } from "../auth/authStore";
import type { OrganizationNodeDto } from "../services/api/apiTypes";

export function getActiveOrganization(user?: AuthUser | null): OrganizationNodeDto | null {
  if (!user) return null;
  const organizations = user.accessible_organizations ?? [];
  const activeOrganizationId = user.active_organization_id ?? user.default_organization_id ?? null;
  return (
    organizations.find((organization) => String(organization.id) === String(activeOrganizationId)) ?? null
  );
}

export function isHeadOfficeOrganization(user?: AuthUser | null): boolean {
  return getActiveOrganization(user)?.node_type === "head_office";
}
