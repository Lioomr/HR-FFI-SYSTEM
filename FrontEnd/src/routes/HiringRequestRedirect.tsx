import { useEffect, useState } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";

import LoadingState from "../components/ui/LoadingState";
import { useAuthStore } from "../auth/authStore";
import { isApiError } from "../services/api/apiTypes";
import { getHiringRequest } from "../services/api/hiringRequestsApi";
import { getToken } from "../services/api/tokenStorage";

/**
 * Compatibility route for `/hiring-requests/:id`.
 *
 * Notifications and workflow deep links point here, but the app has no screen
 * at that path — CEO review lives under `/ceo/...` and HR detail under
 * `/hr/...`. Rather than showing a 404 (or letting the browser hit the DRF
 * endpoint of the same name and get a 401), this resolves the right screen for
 * whoever followed the link.
 */
function ceoPath(id: string): string {
  return `/ceo/hiring-requests/${id}`;
}

function hrPath(id: string): string {
  return `/hr/hiring-requests/${id}`;
}

type Target = { path: string } | { pending: true };

/**
 * Decides from role alone where possible.
 *
 * `null` means the role does not settle it — SystemAdmin holds both HR and CEO
 * capability, and a department-based CEO approver carries no CEO role at all —
 * so the caller falls back to asking the backend who may act on this request.
 */
function targetFromRole(role: string | undefined, ceoHint: boolean): string | null {
  if (ceoHint) return "ceo";
  if (role === "CEO") return "ceo";
  if (role === "HRManager") return "hr";
  return null;
}

export default function HiringRequestRedirect() {
  const location = useLocation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // A CEO notification can say so explicitly; the link still resolves without it.
  const ceoHint = searchParams.get("from") === "ceo";
  const roleTarget = targetFromRole(user?.role, ceoHint);

  const [resolved, setResolved] = useState<Target>({ pending: true });

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    if (roleTarget) {
      setResolved({ path: roleTarget === "ceo" ? ceoPath(id) : hrPath(id) });
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const response = await getHiringRequest(id);
        if (cancelled) return;
        if (isApiError(response)) {
          setResolved({ path: hrPath(id) });
          return;
        }
        const request = response.data;
        // The backend already weighs company scope, workflow stage and whether
        // this user is the assigned approver, so its answer beats any guess.
        const canDecide = Boolean(
          request.workflow?.can_approve || request.workflow?.can_reject,
        );
        setResolved({ path: canDecide ? ceoPath(id) : hrPath(id) });
      } catch {
        if (cancelled) return;
        // Without an answer, send HR staff to their screen and everyone else to
        // the CEO screen — that guard runs its own capability check and will
        // redirect anyone who does not belong there.
        const isHrStaff = user?.role === "HRManager" || user?.role === "SystemAdmin";
        setResolved({ path: isHrStaff ? hrPath(id) : ceoPath(id) });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, roleTarget, user?.role]);

  if (!id) return <Navigate to="/hr/hiring-requests" replace />;

  if (!isAuthenticated) {
    // A stored token with an unhydrated store is a startup race, not a logged
    // out user; bouncing to login there would lose the link.
    if (getToken()) {
      return (
        <div
          role="status"
          aria-label="Verifying session"
          style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}
        >
          <LoadingState title="Verifying Session..." lines={2} />
        </div>
      );
    }
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(from)}`} replace state={{ from }} />;
  }

  if ("pending" in resolved) {
    return (
      <div
        role="status"
        aria-label="Opening hiring request"
        style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}
      >
        <LoadingState lines={2} />
      </div>
    );
  }

  return <Navigate to={resolved.path} replace />;
}
