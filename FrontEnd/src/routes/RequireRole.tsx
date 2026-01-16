import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore, type Role } from "../auth/authStore";

export default function RequireRole({ roles }: { roles: Role[] }) {
  const role = useAuthStore((s) => s.user?.role);

  if (!role || !roles.includes(role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
