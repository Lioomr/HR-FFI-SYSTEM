import { Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { getToken } from "../services/api/tokenStorage";
import LoadingState from "../components/ui/LoadingState";
import { useI18n } from "../i18n/useI18n";

export default function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  const { t } = useI18n();

  if (!isAuthenticated) {
    // Safety: If token exists but store thinks we are logged out,
    // it likely means hydration hasn't finished or we are in a race condition.
    // Show nothing (or spinner) to prevent instant redirect.
    // If it's a real invalid token, 401 interceptor will kill it soon.
    const token = getToken();
    if (token) {
      return (
        <div
          style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}
        >
          <LoadingState title={t("loading.verifyingSession")} lines={2} />
        </div>
      );
    }

    const from = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(from)}`}
        replace
        state={{ from }}
      />
    );
  }

  // Fallback for lazy-loaded route pages that render directly under this
  // guard (e.g. /change-password, /unauthorized) rather than through
  // BaseLayout, which has its own nested Suspense boundary around <Outlet/>.
  return (
    <Suspense
      fallback={
        <div
          style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}
        >
          <LoadingState lines={2} />
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}
