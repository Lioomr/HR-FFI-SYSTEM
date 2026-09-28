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

// Approval areas owned by one role. Employees and managers reach them through
// approver capability, which the destination guard checks.
const OWNED_APPROVAL_AREAS: Record<string, Role> = {
  "/ceo": "CEO",
  "/cfo": "CFO",
};

/**
 * Where to land after switching company. Main Head Office shows a company
 * picker in place of every company page, including pages the role's route
 * guard would refuse (e.g. a CEO link opened by HR), so reloading the same URL
 * after the pick can end on /unauthorized. Keep the page only when the role
 * can use it; otherwise go to the role's home.
 */
export function getCompanySwitchDestination(
  role: Role,
  currentPath: string,
): string {
  const pathname = currentPath.split(/[?#]/, 1)[0];
  const ownedArea = Object.keys(OWNED_APPROVAL_AREAS).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (
    ownedArea &&
    ![
      "SystemAdmin",
      "Employee",
      "Manager",
      OWNED_APPROVAL_AREAS[ownedArea],
    ].includes(role)
  ) {
    return getHomePath(role);
  }
  return canRoleRestorePath(role, currentPath)
    ? currentPath
    : getHomePath(role);
}
