import { useEffect, useState } from "react";
import { Spin } from "antd";
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore, type Role } from "../auth/authStore";
import { getManagerTeam } from "../services/api/managerApi";
import { isApiError } from "../services/api/apiTypes";

export default function RequireRole({ roles }: { roles: Role[] }) {
  const user = useAuthStore((s) => s.user);
  const [managerEligible, setManagerEligible] = useState<boolean | null>(null);

  const canFallbackToManagerAccess =
    !!user &&
    user.role === "Employee" &&
    roles.includes("Manager");

  useEffect(() => {
    let mounted = true;

    if (!canFallbackToManagerAccess) {
      setManagerEligible(null);
      return () => {
        mounted = false;
      };
    }

    setManagerEligible(null);
    getManagerTeam()
      .then((res) => {
        if (!mounted) return;
        setManagerEligible(!isApiError(res));
      })
      .catch(() => {
        if (!mounted) return;
        setManagerEligible(false);
      });

    return () => {
      mounted = false;
    };
  }, [canFallbackToManagerAccess, user?.id]);

  // Strict check: Must have user object AND role must be in allowed list
  if (!user || !user.role) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (roles.includes(user.role)) {
    return <Outlet />;
  }

  if (canFallbackToManagerAccess) {
    if (managerEligible === null) {
      return <div style={{ minHeight: "40vh", display: "grid", placeItems: "center" }}><Spin size="large" /></div>;
    }
    if (managerEligible) {
      return <Outlet />;
    }
  }

  if (!roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
