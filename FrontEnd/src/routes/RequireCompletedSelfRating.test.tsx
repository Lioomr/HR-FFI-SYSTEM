import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/api/contractRatingsApi", () => ({
  getPendingContractRatingActions: vi.fn(),
}));

import RequireCompletedSelfRating from "./RequireCompletedSelfRating";
import { getPendingContractRatingActions } from "../services/api/contractRatingsApi";

const getPendingActions = vi.mocked(getPendingContractRatingActions);

function CurrentPath() {
  const location = useLocation();
  return <div>{location.pathname}</div>;
}

describe("RequireCompletedSelfRating", () => {
  it("redirects to an outstanding employee self-evaluation regardless of list order", async () => {
    getPendingActions.mockResolvedValueOnce({
      status: "success",
      data: {
        employee: { id: 15, status: "PENDING_RESPONSES" },
        manager: null,
      },
    });

    render(
      <MemoryRouter initialEntries={["/employee/dashboard"]}>
        <Routes>
          <Route element={<RequireCompletedSelfRating />}>
            <Route path="/employee/dashboard" element={<CurrentPath />} />
            <Route
              path="/employee/contract-ratings/:id"
              element={<CurrentPath />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("/employee/contract-ratings/15")).toBeTruthy();
    });
    expect(getPendingActions).toHaveBeenCalledTimes(1);
  });
});
