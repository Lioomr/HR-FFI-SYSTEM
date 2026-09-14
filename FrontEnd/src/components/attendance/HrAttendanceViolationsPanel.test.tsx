import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../services/api/attendanceApi", () => ({
  getAttendanceViolations: vi.fn(),
}));
vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

import HrAttendanceViolationsPanel from "./HrAttendanceViolationsPanel";
import { getAttendanceViolations } from "../../services/api/attendanceApi";
import { listEmployees } from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import type { AttendanceLateViolation } from "../../types/attendancePolicy";

const getViolations = vi.mocked(getAttendanceViolations);

const violation = (
  overrides: Partial<AttendanceLateViolation> = {},
): AttendanceLateViolation => ({
  id: 41,
  employee_profile_id: 7,
  employee_code: "FFI-000007",
  employee_name: "Jane Doe",
  employee_name_en: "Jane Doe",
  employee_name_ar: "جين دو",
  date: "2026-09-13",
  occurrence_number: 3,
  daily_rate: "100.00",
  penalty_percent: "0.1000",
  penalty_amount: "10.00",
  lifecycle: "manual_review",
  reason: "post_grace_late",
  void_reason: "late_permission",
  payroll_status: "manual_review",
  created_at: "2026-09-13T09:31:02+03:00",
  updated_at: "2026-09-13T09:31:02+03:00",
  ...overrides,
});

const page = (items: AttendanceLateViolation[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 25, count: items.length, total_pages: 1 },
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPanel(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/hr/attendance${search}`]}>
      <Routes>
        <Route
          path="/hr/attendance"
          element={
            <>
              <HrAttendanceViolationsPanel />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getViolations.mockReset();
  vi.mocked(listEmployees).mockResolvedValue({
    status: "success",
    data: { results: [], count: 0 },
  });
  useI18nStore.getState().setLanguage("en");
  getViolations.mockResolvedValue(page([violation()]));
});

describe("HR violation history filters", () => {
  it("sends the URL filters to the server without filtering client-side", async () => {
    renderPanel(
      "?tab=violations&lifecycle=active,manual_review&payroll_status=pending&employee_profile_id=7&date_from=2026-09-01&date_to=2026-09-13&search=jane&page=2",
    );

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(getViolations).toHaveBeenCalledWith({
      page: 2,
      page_size: 25,
      lifecycle: ["active", "manual_review"],
      payroll_status: ["pending"],
      employee_profile_id: "7",
      date_from: "2026-09-01",
      date_to: "2026-09-13",
      search: "jane",
    });
    expect(screen.getByText("FFI-000007")).toBeInTheDocument();
    expect(screen.getAllByText("Manual review").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.getByText(
        "Invalidated by: Excused by an approved Late Permission",
      ),
    ).toBeInTheDocument();
  });

  it("applies the Needs HR review preset through the URL", async () => {
    renderPanel("?tab=violations");
    await screen.findByText("Jane Doe");

    fireEvent.click(screen.getByRole("button", { name: /Needs HR review/ }));

    await waitFor(() =>
      expect(getViolations).toHaveBeenLastCalledWith(
        expect.objectContaining({ lifecycle: ["manual_review"] }),
      ),
    );
    const search = screen.getByTestId("location").textContent ?? "";
    expect(search).toContain("tab=violations");
    expect(search).toContain("lifecycle=manual_review");
  });

  it("maps 422 filter errors onto the filter controls", async () => {
    getViolations.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Use one or more comma-separated values.",
          errors: [
            {
              field: "lifecycle",
              message:
                "Use one or more comma-separated values: active, void, applied, manual_review.",
            },
            {
              field: "date_to",
              message: "date_to must not be before date_from.",
            },
          ],
        },
      },
    });

    renderPanel("?lifecycle=archived&date_from=2026-09-13&date_to=2026-09-01");

    // antd renders field help asynchronously; allow for a busy test runner.
    const lifecycleError = await screen.findByText(
      "Use one or more comma-separated values: active, void, applied, manual_review.",
      undefined,
      { timeout: 5000 },
    );
    expect(lifecycleError.closest(".ant-form-item")).toHaveTextContent(
      "Lifecycle",
    );
    const dateError = screen.getByText("date_to must not be before date_from.");
    expect(dateError.closest(".ant-form-item")).toHaveTextContent(
      "Violation dates",
    );
    expect(
      screen.getByText("Correct the highlighted filters to see results."),
    ).toBeInTheDocument();
  });

  it("asks for a company on a 403", async () => {
    getViolations.mockRejectedValue({
      response: {
        status: 403,
        data: {
          status: "error",
          message: "Select an active company for this request.",
        },
      },
    });

    renderPanel("?tab=violations");

    expect(
      await screen.findByText("Select a company to see late violations."),
    ).toBeInTheDocument();
  });

  it("shows the Arabic employee name in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    renderPanel("?tab=violations");

    expect(await screen.findByText("جين دو")).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
  });
});
