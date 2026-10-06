import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

// A manager from another company: the response carries the name only, plus a
// leftover legacy `cross_company_managers` payload the page must ignore.
const EMPLOYEE = {
  id: 7,
  employee_id: "FFI-0007",
  full_name: "Omar Khalid",
  email: "omar@ffi.test",
  company_id: 5,
  company_name: "Employer Co",
  employment_status: "ACTIVE",
  is_archived: false,
  manager_profile_id: 40,
  manager_profile_name: "Layla Hassan",
  cross_company_managers: [
    {
      id: 1,
      manager_profile_id: 40,
      manager_name: "Layla Hassan",
      manager_company_name: "Sister Holdings",
      scope_name: "Group",
      end_at: "2027-01-01T00:00:00Z",
    },
  ],
} as unknown as Employee;

beforeEach(() => {
  navigateMock.mockClear();
  getEmployee.mockReset();
  getEmployee.mockResolvedValue({ status: "success", data: EMPLOYEE });
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("ViewEmployeePage manager", () => {
  it("shows one Direct Manager row with the manager's name only", async () => {
    useI18nStore.getState().setLanguage("en");
    render(<ViewEmployeePage />);

    expect(await screen.findByText("Direct Manager")).toBeInTheDocument();
    expect(screen.getAllByText("Layla Hassan")).toHaveLength(1);

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Sister Holdings");
    expect(text).not.toMatch(/cross-company/i);
    expect(text).not.toMatch(/\buntil\b/i);
  });

  it("does not mention another company in Arabic either", async () => {
    useI18nStore.getState().setLanguage("ar");
    render(<ViewEmployeePage />);

    expect(await screen.findByText("المدير المباشر")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Sister Holdings");
    expect(text).not.toContain("شركات أخرى");
    expect(text).not.toContain("حتى");
  });
});
