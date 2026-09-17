import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/api/contractRatingsApi", () => ({
  isManagerRatingView: (view: { manager_response?: unknown }) =>
    "manager_response" in view,
  listContractRatings: vi.fn(),
}));

import RequireCompletedManagerRating from "./RequireCompletedManagerRating";
import { listContractRatings } from "../services/api/contractRatingsApi";

const listRatings = vi.mocked(listContractRatings);

function CurrentPath() {
  return <div>{useLocation().pathname}</div>;
}

describe("RequireCompletedManagerRating", () => {
  it("redirects to an outstanding direct-report evaluation", async () => {
    listRatings.mockResolvedValueOnce({
      status: "success",
      data: {
        items: [
          {
            id: 15,
            status: "PENDING_RESPONSES",
            manager_response: null,
          } as never,
        ],
      },
    });
    listRatings.mockResolvedValueOnce({
      status: "success",
      data: { items: [] },
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
    expect(listRatings).toHaveBeenCalledWith({
      status: "PENDING_RESPONSES",
      page_size: 100,
    });
    expect(listRatings).toHaveBeenCalledWith({
      status: "WAITING_MANAGER",
      page_size: 100,
    });
  });
});
