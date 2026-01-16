import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { getToken } from "../services/api/tokenStorage";
import LoadingState from "../components/ui/LoadingState";

export default function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    // Safety: If token exists but store thinks we are logged out,
    // it likely means hydration hasn't finished or we are in a race condition.
    // Show nothing (or spinner) to prevent instant redirect.
    // If it's a real invalid token, 401 interceptor will kill it soon.
    const token = getToken();
    if (token) {
      return (
        <div style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
          <LoadingState title="Verifying Session..." lines={2} />
        </div>
      );
    }

    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
