import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore, type Role } from "../auth/authStore";

/**
 * Plain role gate. Manager surfaces are guarded by capability instead —
 * see `RequireManagerAccess`.
 */
export default function RequireRole({ roles }: { roles: Role[] }) {
  const user = useAuthStore((s) => s.user);

  // Strict check: Must have user object AND role must be in allowed list
  if (!user || !user.role) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (!roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
