import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/api/contractRatingsApi", () => ({
  getPendingContractRatingActions: vi.fn(),
}));

import RequireCompletedManagerRating from "./RequireCompletedManagerRating";
import { getPendingContractRatingActions } from "../services/api/contractRatingsApi";

const getPendingActions = vi.mocked(getPendingContractRatingActions);

function CurrentPath() {
  return <div>{useLocation().pathname}</div>;
}

describe("RequireCompletedManagerRating", () => {
  it("redirects to an outstanding direct-report evaluation", async () => {
    getPendingActions.mockResolvedValueOnce({
      status: "success",
      data: {
        employee: null,
        manager: { id: 15, status: "PENDING_RESPONSES" },
      },
    });

    render(
      <MemoryRouter initialEntries={["/manager/dashboard"]}>
        <Routes>
          <Route element={<RequireCompletedManagerRating />}>
            <Route path="/manager/dashboard" element={<CurrentPath />} />
            <Route
              path="/manager/contract-ratings/:id"
              element={<CurrentPath />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("/manager/contract-ratings/15")).toBeTruthy();
    });
    expect(getPendingActions).toHaveBeenCalledTimes(1);
  });
});
