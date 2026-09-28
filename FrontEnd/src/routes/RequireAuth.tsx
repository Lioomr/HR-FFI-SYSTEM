import { Suspense, useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { message } from "antd";
import { useAuthStore } from "../auth/authStore";
import { getToken } from "../services/api/tokenStorage";
import LoadingState from "../components/ui/LoadingState";
import { useI18n } from "../i18n/useI18n";
import { resolveCompanyLink } from "../utils/organizationContext";

// Survives the reload that follows a company switch, so the notice shows after it.
const COMPANY_LINK_NOTICE_KEY = "ffi.companyLinkNotice";

export default function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setActiveOrganization = useAuthStore((s) => s.setActiveOrganization);
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const switchingRef = useRef(false);

  const companyLink = isAuthenticated
    ? resolveCompanyLink(location, user)
    : null;
  const switchToId = companyLink?.switchTo?.id ?? null;
  const switchToName = companyLink?.switchTo?.name ?? "";
  const cleanPath = companyLink?.cleanPath ?? null;

  useEffect(() => {
    if (cleanPath == null || switchingRef.current) return;
    if (switchToId == null) {
      navigate(cleanPath, { replace: true });
      return;
    }
    switchingRef.current = true;
    setActiveOrganization(switchToId);
    try {
      sessionStorage.setItem(COMPANY_LINK_NOTICE_KEY, switchToName);
    } catch {
      // The notice is optional; the switch itself is already saved.
    }
    // Reload like the company switcher so every screen starts in the new company.
    window.location.replace(cleanPath);
  }, [cleanPath, switchToId, switchToName, navigate, setActiveOrganization]);

  useEffect(() => {
    // Wait until the link is handled; the switch writes this key just before reloading.
    if (!isAuthenticated || cleanPath != null) return;
    let company: string | null = null;
    try {
      company = sessionStorage.getItem(COMPANY_LINK_NOTICE_KEY);
      sessionStorage.removeItem(COMPANY_LINK_NOTICE_KEY);
    } catch {
      return;
    }
    if (company) message.info(t("organization.switchedForLink", { company }));
  }, [isAuthenticated, cleanPath, t]);

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

  // Hold the page until the link's company is selected, so it never loads
  // data from the wrong company.
  if (companyLink) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <LoadingState lines={2} />
      </div>
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
