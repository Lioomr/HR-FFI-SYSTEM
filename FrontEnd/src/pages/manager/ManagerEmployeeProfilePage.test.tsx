import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/employeesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api/employeesApi")>()),
  getEmployee: vi.fn(),
}));

vi.mock("../../services/api/managerSummaryApi", () => ({
  getManagerWorkSummary: vi.fn(),
  MANAGER_QUEUE_KEYS: ["leave", "loan", "attendance", "assetReturn"],
}));

// The balances widget calls its own endpoint and is out of scope here.
vi.mock("../hr/employees/components/EmployeeLeaveBalances", () => ({
  default: () => <div data-testid="leave-balances" />,
}));

import ManagerEmployeeProfilePage from "./ManagerEmployeeProfilePage";
import { getEmployee, type Employee } from "../../services/api/employeesApi";
import { getManagerWorkSummary } from "../../services/api/managerSummaryApi";
import type { ManagerWorkSummary } from "../../services/api/managerSummaryApi";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";

const mockedGetEmployee = vi.mocked(getEmployee);
const mockedSummary = vi.mocked(getManagerWorkSummary);

/**
 * Every compensation label and value the page must never print. The employee
 * payload below carries all of them, so a regression that re-adds a salary
 * panel fails here rather than shipping pay data to a manager.
 */
const SALARY_LABELS = [
  "Salary Details",
  "Basic Salary",
  "Total Salary",
  "Allowances",
  "Transportation",
  "Accommodation",
];

const SALARY_VALUES = ["12000", "18500", "1500", "2000", "300", "450"];

const EMPLOYEE = {
  id: 11,
  employee_id: "FFI-0011",
  full_name: "Sara Idris",
  email: "sara@ffi.test",
  mobile: "0500000001",
  position: "Site Engineer",
  department: "Operations",
  employment_status: "ACTIVE",
  nationality: "Egypt",
  date_of_birth: "1992-03-04",
  join_date: "2021-06-01",
  contract_expiry: "2027-05-31",
  task_group: "Field",
  sponsor: "FFI",
  allowed_overtime: 20,
  // Compensation fields are present on the payload on purpose.
  basic_salary: 12000,
  total_salary: 18500,
  transportation_allowance: 1500,
  accommodation_allowance: 2000,
  telephone_allowance: 300,
  other_allowance: 450,
} as unknown as Employee;

const EMPTY_SUMMARY: ManagerWorkSummary = {
  queues: {
    leave: { key: "leave", count: 0, available: true, items: [] },
    loan: { key: "loan", count: 0, available: true, items: [] },
    attendance: { key: "attendance", count: 0, available: true, items: [] },
    assetReturn: { key: "assetReturn", count: 0, available: true, items: [] },
  },
  items: [],
  totalPending: 0,
  allUnavailable: false,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/team/11"]}>
      <Routes>
        <Route
          path="/manager/team/:id"
          element={<ManagerEmployeeProfilePage />}
        />
        <Route path="/manager/team" element={<div>My Team</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ManagerEmployeeProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.getState().setLanguage("en");
    mockedGetEmployee.mockResolvedValue({ status: "success", data: EMPLOYEE });
    mockedSummary.mockResolvedValue(EMPTY_SUMMARY);
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "21", email: "lead@ffi.test", role: "Employee" },
    });
  });

  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
  });

  it("shows identity, contact, employment, leave balances and open requests", async () => {
    renderPage();

    expect(await screen.findByText("Employee")).toBeInTheDocument();
    expect(screen.getAllByText("Sara Idris").length).toBeGreaterThan(0);
    expect(screen.getByText("sara@ffi.test")).toBeInTheDocument();
    expect(screen.getByText("0500000001")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Employment Info/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Leave Balances/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Open requests")).toBeInTheDocument();
  });

  it("does not offer a salary tab", async () => {
    renderPage();
    await screen.findByRole("tab", { name: /Employment Info/ });

    expect(
      screen.queryByRole("tab", { name: /Salary/ }),
    ).not.toBeInTheDocument();
    // Employment and leave balances are the only two tabs left.
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("never renders a compensation label anywhere on the page", async () => {
    renderPage();
    await screen.findByRole("tab", { name: /Employment Info/ });

    SALARY_LABELS.forEach((label) => {
      expect(
        screen.queryByText(label),
        `"${label}" must not appear on a manager profile`,
      ).not.toBeInTheDocument();
    });
  });

  it("never renders a salary or allowance amount, even after opening every tab", async () => {
    renderPage();
    await screen.findByRole("tab", { name: /Employment Info/ });

    fireEvent.click(screen.getByRole("tab", { name: /Leave Balances/ }));
    expect(await screen.findByTestId("leave-balances")).toBeInTheDocument();

    // Assert on the rendered text rather than on queries, so a value
    // reappearing under any label is still caught.
    const body = document.body.textContent ?? "";
    SALARY_VALUES.forEach((value) => {
      expect(
        body,
        `salary amount ${value} leaked into the manager profile`,
      ).not.toContain(value);
    });
    expect(body.toLowerCase()).not.toContain("payroll");
  });

  it("stays read-only: it states so and offers no edit affordance", async () => {
    renderPage();

    expect(
      await screen.findByText(
        "This profile is read-only. Employee records are maintained by HR.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Delete|Archive/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the employment details a manager does need", async () => {
    renderPage();
    await screen.findByRole("tab", { name: /Employment Info/ });

    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByText("2021-06-01")).toBeInTheDocument();
    expect(screen.getByText("2027-05-31")).toBeInTheDocument();
  });
});
