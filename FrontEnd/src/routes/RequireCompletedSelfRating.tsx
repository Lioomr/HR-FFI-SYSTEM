import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import LoadingState from "../components/ui/LoadingState";
import { useI18n } from "../i18n/useI18n";
import {
  isApiError,
  type ApiSuccess,
  type PaginatedResponse,
} from "../services/api/apiTypes";
import {
  listContractRatings,
  type ContractRatingStatus,
  type ContractRatingView,
} from "../services/api/contractRatingsApi";

/** Statuses in which the signed-in employee still owes their own self-rating. */
const PENDING_FOR_EMPLOYEE: ReadonlySet<ContractRatingStatus> = new Set([
  "PENDING_RESPONSES",
  "WAITING_EMPLOYEE",
]);

type Check =
  | { state: "loading" }
  | { state: "clear" }
  | { state: "pending"; id: number };

/**
 * Blocks any employee-capability route behind an outstanding self-rating.
 *
 * It protects the employee self-service surface and the manager surface. A
 * manager is an employee with additional privileges, so their own unfinished
 * self-rating also blocks those additional privileges. HR and CEO-only routes
 * remain outside this gate.
 *
 * Fails open on any fetch error: a broken network call must never lock
 * someone out of the whole employee portal.
 */
export default function RequireCompletedSelfRating() {
  const { t } = useI18n();
  const location = useLocation();
  const [check, setCheck] = useState<Check>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    // Request each actionable status explicitly.  A plain list is paginated
    // newest-first, which could otherwise leave an older outstanding rating
    // outside the first page and accidentally open the employee portal.
    Promise.all(
      [...PENDING_FOR_EMPLOYEE].map((status) =>
        listContractRatings({ status, page_size: 100 }),
      ),
    )
      .then((responses) => {
        if (cancelled) return;
        const successfulResponses = responses.filter(
          (
            response,
          ): response is ApiSuccess<PaginatedResponse<ContractRatingView>> =>
            !isApiError(response),
        );
        if (successfulResponses.length !== responses.length) {
          setCheck({ state: "clear" });
          return;
        }
        const items = successfulResponses.flatMap(
          (response) => response.data.items ?? [],
        );
        const pending = items.find(
          (item: ContractRatingView) =>
            item.viewer === "employee" && PENDING_FOR_EMPLOYEE.has(item.status),
        );
        setCheck(
          pending
            ? { state: "pending", id: pending.id }
            : { state: "clear" },
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
    const target = `/employee/contract-ratings/${check.id}`;
    if (location.pathname !== target) {
      return <Navigate to={target} replace />;
    }
  }

  return <Outlet />;
}
