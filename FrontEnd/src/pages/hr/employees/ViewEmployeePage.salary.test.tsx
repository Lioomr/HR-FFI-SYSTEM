import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "7" }),
}));

vi.mock("../../../services/api/employeesApi", () => ({
  getEmployee: vi.fn(),
  restoreEmployee: vi.fn(),
}));

vi.mock("../../../services/api/usersApi", () => ({
  listUsers: vi
    .fn()
    .mockResolvedValue({ status: "success", data: { results: [] } }),
}));

vi.mock("../../../services/api/apiClient", () => ({
  api: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

vi.mock("./components/EmployeeLeaveBalances", () => ({
  default: () => <div data-testid="leave-balances" />,
}));

vi.mock("../../../components/employees/EmployeeDocumentArchive", () => ({
  default: () => <div data-testid="document-archive" />,
}));

import ViewEmployeePage from "./ViewEmployeePage";
import * as employeesApi from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const getEmployee = employeesApi.getEmployee as unknown as ReturnType<
  typeof vi.fn
>;

const EMPLOYEE = {
  id: 7,
  employee_id: "FFI-0007",
  full_name: "Omar Khalid",
  email: "omar@ffi.test",
  position: "Technician",
  department: "Operations",
  employment_status: "ACTIVE",
  is_archived: false,
  basic_salary: 12000,
  total_salary: 18500,
  transportation_allowance: 1500,
} as unknown as Employee;

beforeEach(() => {
  navigateMock.mockClear();
  getEmployee.mockReset();
  getEmployee.mockResolvedValue({ status: "success", data: EMPLOYEE });
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

/**
 * Salary was removed from the manager profile only. HR keeps it, so this guards
 * the HR view against that change leaking across the two screens.
 */
describe("ViewEmployeePage salary visibility", () => {
  it("still offers the salary tab to HR", async () => {
    render(<ViewEmployeePage />);

    expect(
      await screen.findByRole("tab", { name: /Salary Details/ }),
    ).toBeInTheDocument();
  });

  it("still shows compensation figures to HR", async () => {
    render(<ViewEmployeePage />);

    fireEvent.click(await screen.findByRole("tab", { name: /Salary Details/ }));

    expect(await screen.findByText("Basic Salary")).toBeInTheDocument();
    expect(screen.getByText("Total Salary")).toBeInTheDocument();
    expect(screen.getByText("Allowances")).toBeInTheDocument();
    expect(document.body.textContent).toContain("12,000");
  });
});
