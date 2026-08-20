import { Button } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { Navigate, Outlet, useNavigate } from "react-router-dom";

import { useAuthStore, type Role } from "../auth/authStore";
import { useManagerAccess } from "../hooks/useManagerAccess";
import LoadingState from "../components/ui/LoadingState";
import { useI18n } from "../i18n/useI18n";

/** Shown when the signed-in user has no manager capability for /manager/*. */
function ManagerAccessForbidden() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div
      role="alert"
      style={{
        background: "white",
        borderRadius: 16,
        padding: "56px 24px",
        textAlign: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        maxWidth: 520,
        margin: "40px auto",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: "linear-gradient(135deg, #fff4e6, #fff7ed)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
        }}
      >
        <LockOutlined style={{ fontSize: 32, color: "#f97316" }} />
      </div>

      <div style={{ fontWeight: 700, fontSize: 18, color: "#0f172a", marginBottom: 8 }}>
        {t("manager.access.forbiddenTitle", "Manager access not available")}
      </div>

      <div style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
        {t(
          "manager.access.forbiddenDesc",
          "You do not have any employees reporting to you, so team management pages are unavailable. Ask HR to assign you as a direct manager if this is unexpected."
        )}
      </div>

      <Button type="primary" size="large" onClick={() => navigate("/")} style={{ borderRadius: 10 }}>
        {t("error.notFound.backHome", "Back to Home")}
      </Button>
    </div>
  );
}

/**
 * Guards /manager/* by manager capability instead of role.
 *
 * `allowRoles` keeps the roles that reach the manager surface through their own
 * mandate (CEO/CFO/SystemAdmin); everyone else — including Manager-group users —
 * is admitted only when the backend reports `has_access`.
 */
export default function RequireManagerAccess({ allowRoles = [] }: { allowRoles?: Role[] }) {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const roleAllowed = Boolean(user?.role && allowRoles.includes(user.role));
  const { access, loading } = useManagerAccess({ enabled: Boolean(user?.role) && !roleAllowed });

  if (!user || !user.role) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (roleAllowed) {
    return <Outlet />;
  }

  if (loading) {
    const checkingLabel = t("manager.access.checking", "Checking manager access...");
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

  return <ManagerAccessForbidden />;
}
