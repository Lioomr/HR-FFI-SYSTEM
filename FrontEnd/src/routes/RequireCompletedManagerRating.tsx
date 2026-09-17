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
  isManagerRatingView,
  listContractRatings,
  type ContractRatingStatus,
  type ContractRatingView,
} from "../services/api/contractRatingsApi";

/** Statuses in which the current manager still owes an evaluation. */
const PENDING_FOR_MANAGER: ReadonlySet<ContractRatingStatus> = new Set([
  "PENDING_RESPONSES",
  "WAITING_MANAGER",
]);

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
    // Each status is requested explicitly. The default list is paginated
    // newest-first, so it cannot safely determine whether work is outstanding.
    Promise.all(
      [...PENDING_FOR_MANAGER].map((status) =>
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
        const pending = successfulResponses
          .flatMap((response) => response.data.items ?? [])
          .find(
            (item: ContractRatingView | Record<string, never>) =>
              "id" in item &&
              "status" in item &&
              isManagerRatingView(item) &&
              PENDING_FOR_MANAGER.has(item.status as ContractRatingStatus),
          );
        setCheck(
          pending && "id" in pending
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
    const target = `/manager/contract-ratings/${check.id}`;
    if (location.pathname !== target) return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
