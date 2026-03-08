import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

import { useAuthStore } from "../auth/authStore";
import { getEmployee } from "../services/api/employeesApi";
import { isApiError } from "../services/api/apiTypes";
import LoadingState from "../components/ui/LoadingState";
import { isCEOApproverEmployee } from "../utils/ceoApprover";

export default function RequireCEOApprover() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (!user) {
        if (mounted) {
          setAllowed(false);
          setLoading(false);
        }
        return;
      }

      try {
        const res = await getEmployee("me");
        if (!mounted) return;
        if (isApiError(res)) {
          setAllowed(false);
        } else {
          setAllowed(isCEOApproverEmployee(res.data));
        }
      } catch {
        if (mounted) setAllowed(false);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    check();
    return () => {
      mounted = false;
    };
  }, [user]);

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <LoadingState title="Checking Access..." lines={1} />
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/unauthorized" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
