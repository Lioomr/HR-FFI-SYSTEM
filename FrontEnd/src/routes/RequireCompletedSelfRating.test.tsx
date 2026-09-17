import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/api/contractRatingsApi", () => ({
  isEmployeeRatingView: (view: { employee_response?: unknown }) =>
    "employee_response" in view,
  listContractRatings: vi.fn(),
}));

import RequireCompletedSelfRating from "./RequireCompletedSelfRating";
import { listContractRatings } from "../services/api/contractRatingsApi";

const listRatings = vi.mocked(listContractRatings);

function CurrentPath() {
  const location = useLocation();
  return <div>{location.pathname}</div>;
}

describe("RequireCompletedSelfRating", () => {
  it("redirects to an outstanding employee self-evaluation regardless of list order", async () => {
    listRatings.mockResolvedValueOnce({
      status: "success",
      data: {
        items: [
          {
            id: 15,
            status: "PENDING_RESPONSES",
            employee_response: null,
          } as never,
        ],
      },
    });
    listRatings.mockResolvedValueOnce({
      status: "success",
      data: { items: [] },
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
    expect(listRatings).toHaveBeenCalledWith({
      status: "PENDING_RESPONSES",
      page_size: 100,
    });
    expect(listRatings).toHaveBeenCalledWith({
      status: "WAITING_EMPLOYEE",
      page_size: 100,
    });
  });
});
