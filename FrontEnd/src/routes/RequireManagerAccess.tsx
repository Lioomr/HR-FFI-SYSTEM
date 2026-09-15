import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore, type Role } from "../auth/authStore";
import { useManagerAccess } from "../hooks/useManagerAccess";
import LoadingState from "../components/ui/LoadingState";
import { useI18n } from "../i18n/useI18n";
import type { UnauthorizedReason } from "../pages/Unauthorized403Page";

/**
 * Guards /manager/* by manager capability instead of role.
 *
 * `allowRoles` keeps the roles that reach the manager surface through their own
 * mandate (CEO/CFO/SystemAdmin); everyone else — including Manager-group users —
 * is admitted only when the backend reports `has_access`.
 */
export default function RequireManagerAccess({
  allowRoles = [],
}: {
  allowRoles?: Role[];
}) {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const roleAllowed = Boolean(user?.role && allowRoles.includes(user.role));
  const { access, loading, failed } = useManagerAccess({
    enabled: Boolean(user?.role) && !roleAllowed,
  });

  if (!user || !user.role) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (roleAllowed) {
    return <Outlet />;
  }

  if (loading) {
    const checkingLabel = t(
      "manager.access.checking",
      "Checking manager access...",
    );
    return (
      <div
        role="status"
        aria-label={checkingLabel}
        style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}
      >
        <LoadingState title={checkingLabel} lines={1} />
      </div>
    );
  }

  if (access.has_access) {
    return <Outlet />;
  }

  // Only a confirmed "no direct reports" answer explains itself on the 403
  // page; a failed capability check stays a generic denial.
  const state: { reason: UnauthorizedReason } | undefined = failed
    ? undefined
    : { reason: "no_direct_reports" };
  return <Navigate to="/unauthorized" replace state={state} />;
}
