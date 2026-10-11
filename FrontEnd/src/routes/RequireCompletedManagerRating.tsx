import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import LoadingState from "../components/ui/LoadingState";
import { useI18n } from "../i18n/useI18n";
import { isApiError } from "../services/api/apiTypes";
import { getPendingContractRatingActions } from "../services/api/contractRatingsApi";

type Check =
  | { state: "loading" }
  | { state: "clear" }
  | { state: "pending"; id: number };

/**
 * Blocks every /manager/* route behind an outstanding direct-report rating.
 * Like the employee gate, it deliberately fails open if its eligibility
 * request cannot be completed, so a transient API outage does not lock a
 * manager out of all management work.
 */
export default function RequireCompletedManagerRating() {
  const { t } = useI18n();
  const location = useLocation();
  const [check, setCheck] = useState<Check>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    getPendingContractRatingActions()
      .then((response) => {
        if (cancelled) return;
        if (isApiError(response)) {
          setCheck({ state: "clear" });
          return;
        }
        const pending = response.data.manager;
        setCheck(
          pending ? { state: "pending", id: pending.id } : { state: "clear" },
        );
      })
      .catch(() => {
        if (!cancelled) setCheck({ state: "clear" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (check.state === "loading") {
    const label = t(
      "contractRatings.checkingPending",
      "Checking your contract rating status...",
    );
    return (
      <div
        role="status"
        aria-label={label}
        style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}
      >
        <LoadingState title={label} lines={1} />
      </div>
    );
  }

  if (check.state === "pending") {
    const target = `/manager/contract-ratings/${check.id}`;
    if (location.pathname !== target) return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
