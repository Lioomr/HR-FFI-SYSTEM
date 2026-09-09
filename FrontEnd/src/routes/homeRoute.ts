import type { Role } from "../auth/authStore";

const homePathByRole: Record<Role, string> = {
  SystemAdmin: "/admin/dashboard",
  HRManager: "/hr/dashboard",
  Manager: "/employee/dashboard",
  CEO: "/ceo/dashboard",
  CFO: "/cfo/dashboard",
  Employee: "/employee/dashboard",
};

export function getHomePath(role: Role | null | undefined): string {
  return role ? homePathByRole[role] : "/login";
}

/**
 * A page may be visible to several roles, but an interrupted or previous-login
 * page must only be restored for the role area it belongs to. This prevents an
 * account switch from resuming an Employee deep link in an HR session.
 */
function canRoleRestorePath(role: Role, path: string): boolean {
  if (path === "/" || path === "/unauthorized" || path === "/login") {
    return false;
  }

  const rolePrefixes: Record<Role, string[]> = {
    SystemAdmin: ["/admin", "/hr", "/ceo", "/cfo", "/manager", "/employee"],
    HRManager: ["/hr"],
    Manager: ["/manager", "/employee"],
    CEO: ["/ceo"],
    CFO: ["/cfo"],
    Employee: ["/employee"],
  };

  if (
    rolePrefixes[role].some(
      (prefix) =>
        path === prefix ||
        path.startsWith(`${prefix}/`) ||
        path.startsWith(`${prefix}?`),
    )
  ) {
    return true;
  }

  return ["/change-password", "/pending-inbox", "/notifications"].some(
    (allowedPath) => path === allowedPath || path.startsWith(`${allowedPath}?`),
  );
}

export function getPostLoginDestination(
  role: Role,
  requestedPath: string | null | undefined,
): string {
  const fallback = getHomePath(role);
  if (
    !requestedPath ||
    !requestedPath.startsWith("/") ||
    requestedPath.startsWith("//") ||
    requestedPath.includes("\\") ||
    !canRoleRestorePath(role, requestedPath)
  ) {
    return fallback;
  }
  return requestedPath;
}
