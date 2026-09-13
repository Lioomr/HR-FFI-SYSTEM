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
 * Restore role areas and capability-based approval areas. The destination
 * route guard remains responsible for checking actual approver access.
 */
function canRoleRestorePath(role: Role, path: string): boolean {
  if (path === "/" || path === "/unauthorized" || path === "/login") {
    return false;
  }

  const pathname = path.split(/[?#]/, 1)[0];
  if (
    ["/manager", "/ceo", "/cfo", "/finance"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  )
    return true;

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
  // Old reminder URLs must also survive authentication before their redirect.
  requestedPath = requestedPath?.replace(/^\/employees\//, "/hr/employees/");
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
