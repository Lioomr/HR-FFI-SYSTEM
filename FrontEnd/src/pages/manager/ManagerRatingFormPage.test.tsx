import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/contractRatingsApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/api/contractRatingsApi")
  >()),
  getRatingCriteria: vi.fn(),
  getContractRating: vi.fn(),
  submitManagerRatingResponse: vi.fn(),
  submitEmployeeRatingResponse: vi.fn(),
}));

import ManagerRatingFormPage from "./ManagerRatingFormPage";
import * as api from "../../services/api/contractRatingsApi";
import { useI18nStore } from "../../i18n/i18nStore";

const managerView: api.ManagerContractRatingView = {
  viewer: "manager",
  id: 2,
  status: "WAITING_MANAGER",
  rating_mode: "RATE",
  company: 5,
  employee: {
    id: 4,
    employee_id: "E-1",
    employee_number: "",
    full_name: "Rated Employee",
    department: "",
    section: "",
    job_title: "Engineer",
    manager_at_creation: 3,
  },
  evaluation_period_from: null,
  evaluation_period_to: null,
  contract_date: "2025-12-05",
  contract_expiry: "2026-12-05",
  manager_name: "Manager",
  manager_response: null,
};

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  vi.mocked(api.getRatingCriteria).mockResolvedValue({
    status: "success",
    data: {
      criteria: [
        { code: "appearance", label_en: "Appearance", label_ar: "المظهر", display_order: 1 },
      ],
      grade_ranges: {
        EXCELLENT: [90, 100],
        VERY_GOOD: [80, 89],
        GOOD: [70, 79],
        ACCEPTABLE: [60, 69],
        POOR: [0, 59],
      },
    },
  });
  vi.mocked(api.getContractRating).mockResolvedValue({
    status: "success",
    data: managerView,
  });
  vi.mocked(api.submitManagerRatingResponse)
    .mockReset()
    .mockResolvedValue({
      status: "success",
      data: { ...managerView, status: "PENDING_CEO" },
    });
});

describe("ManagerRatingFormPage", () => {
  it("renders the same decision-free form and posts to the manager endpoint", async () => {
    render(
      <MemoryRouter initialEntries={["/manager/contract-ratings/2"]}>
        <Routes>
          <Route
            path="/manager/contract-ratings/:id"
            element={<ManagerRatingFormPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("1. Appearance")).toBeTruthy();
    // No recommendation, change-type or salary control exists on this form.
    expect(screen.queryByText(/recommend/i)).toBeNull();
    expect(screen.queryByText(/salary/i)).toBeNull();

    fireEvent.click(screen.getByText("Poor"));
    fireEvent.change(screen.getByLabelText("Score: Appearance"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit evaluation" }));

    await waitFor(() =>
      expect(api.submitManagerRatingResponse).toHaveBeenCalledWith(2, {
        criterion_ratings: {
          appearance: { grade: "POOR", score: 40, remark: "" },
        },
        overall_remark: "",
      }),
    );
    expect(api.submitEmployeeRatingResponse).not.toHaveBeenCalled();
  });
});
