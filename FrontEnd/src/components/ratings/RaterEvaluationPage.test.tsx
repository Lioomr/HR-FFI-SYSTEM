import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/contractRatingsApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/api/contractRatingsApi")
  >()),
  getRatingCriteria: vi.fn(),
  getContractRating: vi.fn(),
  downloadContractRatingPdf: vi.fn(),
}));

import RaterEvaluationPage from "./RaterEvaluationPage";
import * as api from "../../services/api/contractRatingsApi";
import { useI18nStore } from "../../i18n/i18nStore";

const downloadPdf = vi.mocked(api.downloadContractRatingPdf);

const submittedView: api.EmployeeContractRatingView = {
  viewer: "employee",
  id: 1,
  status: "WAITING_MANAGER",
  rating_mode: "RATE",
  company: 5,
  employee: {
    id: 4,
    employee_id: "RTUI-emp1",
    employee_number: "",
    full_name: "RT EMP1",
    department: "",
    section: "",
    job_title: "Engineer",
    manager_at_creation: 3,
  },
  evaluation_period_from: "2025-12-05",
  evaluation_period_to: "2026-12-05",
  contract_date: "2025-12-05",
  contract_expiry: "2026-12-05",
  manager_name: "RT MGR",
  employee_response: {
    id: 9,
    rater_type: "EMPLOYEE",
    status: "SUBMITTED",
    submitted_by: 4,
    submitted_by_name: "RT EMP1",
    criterion_ratings: {},
    average_score: "90.00",
    overall_grade: "EXCELLENT",
    overall_remark: "",
    submitted_at: "2026-09-10T08:00:00Z",
    returned_at: null,
    returned_by: null,
    return_reason: "",
    created_at: "2026-09-10T08:00:00Z",
    updated_at: "2026-09-10T08:00:00Z",
  },
};

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  vi.mocked(api.getRatingCriteria).mockResolvedValue({
    status: "success",
    data: { criteria: [], grade_ranges: {} as api.GradeRanges },
  });
  vi.mocked(api.getContractRating).mockResolvedValue({
    status: "success",
    data: submittedView,
  });
  downloadPdf
    .mockReset()
    .mockResolvedValue(new Blob(["not a pdf"], { type: "text/plain" }));
});

describe("RaterEvaluationPage PDF preview", () => {
  it("previews the rating PDF in-app instead of opening a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <MemoryRouter initialEntries={["/employee/contract-ratings/1"]}>
        <Routes>
          <Route
            path="/employee/contract-ratings/:id"
            element={<RaterEvaluationPage rater="employee" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Preview PDF/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Preview PDF");
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledWith("1"));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
