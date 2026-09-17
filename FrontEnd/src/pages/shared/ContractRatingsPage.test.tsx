import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock(
  "../../services/api/contractRatingsApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../services/api/contractRatingsApi")
    >()),
    getRatingCriteria: vi.fn(),
    getContractRating: vi.fn(),
    listContractRatings: vi.fn(),
  }),
);

import ContractRatingsPage from "./ContractRatingsPage";
import * as api from "../../services/api/contractRatingsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getRating = vi.mocked(api.getContractRating);

const header = {
  id: 1,
  status: "PENDING_HR" as const,
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
};

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    user: { id: "3", email: "hr@example.com", role: "HRManager" },
  } as never);
  vi.mocked(api.getRatingCriteria).mockResolvedValue({
    status: "success",
    data: { criteria: [], grade_ranges: {} as api.GradeRanges },
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/hr/contract-ratings/:id" element={<ContractRatingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ContractRatingsPage", () => {
  // An HR user who also manages this employee gets the manager-shaped payload
  // from the backend; the page must not build an HR review from it.
  it("shows a restricted notice, not HR actions, for a manager-shaped payload", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: { ...header, manager_response: null },
    });
    renderAt("/hr/contract-ratings/1");
    expect(
      await screen.findByText("You are a rater on this evaluation"),
    ).toBeTruthy();
    expect(screen.queryByText("Approve and send to CEO")).toBeNull();
    expect(screen.queryByText("Comparison")).toBeNull();
  });

  it("offers HR review actions on the full package while pending HR", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...header,
        manager_response: null,
        employee_response: null,
        comparison_summary: {},
        workflow: { status: "in_review", history: [] },
        current_terms: {},
        salary_before_snapshot: {},
        ceo_approved_terms: {},
        salary_after_snapshot: {},
        recommended_change_types: [],
      } as unknown as api.FullContractRating,
    });
    renderAt("/hr/contract-ratings/1");
    expect(await screen.findByText("Approve and send to CEO")).toBeTruthy();
    expect(screen.getByText("Return for correction")).toBeTruthy();
  });
});
