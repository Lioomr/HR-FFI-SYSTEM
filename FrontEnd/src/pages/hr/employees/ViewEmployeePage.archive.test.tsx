import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

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
const restoreEmployee = employeesApi.restoreEmployee as unknown as ReturnType<
  typeof vi.fn
>;

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 7,
    employee_id: "FFI-0007",
    full_name: "Omar Khalid",
    email: "omar@ffi.test",
    position: "Technician",
    department: "Operations",
    employment_status: "ACTIVE",
    is_archived: false,
    ...overrides,
  } as Employee;
}

const ARCHIVED = makeEmployee({
  is_archived: true,
  archived_at: "2026-05-04T09:00:00Z",
  archived_by: 3,
  archived_by_name: "Archive Administrator",
  archive_reason: "RETIRED",
});

beforeEach(() => {
  navigateMock.mockClear();
  getEmployee.mockReset();
  restoreEmployee.mockReset();
  getEmployee.mockResolvedValue({ status: "success", data: ARCHIVED });

  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("ViewEmployeePage archived employee", () => {
  it("renders the work license expiry on the employee profile", async () => {
    getEmployee.mockResolvedValue({
      status: "success",
      data: makeEmployee({ work_license_expiry: "2026-11-30" }),
    });

    render(<ViewEmployeePage />);

    const workLicenseCard = await screen.findByTestId(
      "work-license-expiry-card",
    );
    expect(workLicenseCard).toHaveTextContent("Work License Expiry");
    expect(workLicenseCard).toHaveTextContent("2026-11-30");
  });

  it("shows the existing missing-value placeholder when work license expiry is absent", async () => {
    getEmployee.mockResolvedValue({ status: "success", data: makeEmployee() });

    render(<ViewEmployeePage />);

    const workLicenseCard = await screen.findByTestId(
      "work-license-expiry-card",
    );
    expect(workLicenseCard).toHaveTextContent(/Expires:\s*—/);
  });

  it("shows the archived banner with the reason and archive date", async () => {
    render(<ViewEmployeePage />);

    expect(
      await screen.findByText("This employee is archived"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/All historical records remain available/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Archive Reason:\s*Retired/)).toBeInTheDocument();
    expect(screen.getByText(/Archived on:\s*2026-05-04/)).toBeInTheDocument();
    expect(
      screen.getByText(/Archived by:\s*Archive Administrator/),
    ).toBeInTheDocument();
  });

  it("omits the archiver line when the backend returns no name", async () => {
    getEmployee.mockResolvedValue({
      status: "success",
      data: { ...ARCHIVED, archived_by: null, archived_by_name: null },
    });

    render(<ViewEmployeePage />);
    await screen.findByText("This employee is archived");

    expect(screen.queryByText(/Archived by:/)).not.toBeInTheDocument();
    // The reason and date still render, so the banner degrades gracefully.
    expect(screen.getByText(/Archive Reason:\s*Retired/)).toBeInTheDocument();
  });

  it("never renders the raw archiver id", async () => {
    render(<ViewEmployeePage />);
    await screen.findByText("This employee is archived");

    const banner = screen
      .getByText("This employee is archived")
      .closest(".ant-alert") as HTMLElement;
    expect(banner).not.toHaveTextContent(/\b3\b/);
  });

  it("does not show the archived banner for an active employee", async () => {
    getEmployee.mockResolvedValue({ status: "success", data: makeEmployee() });

    render(<ViewEmployeePage />);
    // The name renders in both the page header and the hero card.
    await screen.findAllByText("Omar Khalid");

    expect(
      screen.queryByText("This employee is archived"),
    ).not.toBeInTheDocument();
  });

  it("restores the employee and reloads the profile", async () => {
    restoreEmployee.mockResolvedValue({
      status: "success",
      data: makeEmployee({
        is_archived: false,
        archive_reason: null,
        archived_at: null,
      }),
    });

    render(<ViewEmployeePage />);
    await screen.findByText("This employee is archived");

    fireEvent.click(screen.getByRole("button", { name: "Restore Employee" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Restore Employee" }),
    );

    await waitFor(() => expect(restoreEmployee).toHaveBeenCalledWith(7));
    await waitFor(() => expect(getEmployee).toHaveBeenCalledTimes(2));
  });

  it("shows the backend error message when the restore fails", async () => {
    restoreEmployee.mockResolvedValue({
      status: "error",
      message: "Employee is not archived.",
    });

    render(<ViewEmployeePage />);
    await screen.findByText("This employee is archived");

    fireEvent.click(screen.getByRole("button", { name: "Restore Employee" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Restore Employee" }),
    );

    expect(
      await within(dialog).findByText("Employee is not archived."),
    ).toBeInTheDocument();
  });

  it("hides the restore action from roles that cannot restore", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "2", email: "manager@ffi.test", role: "Manager" },
    });

    render(<ViewEmployeePage />);
    await screen.findByText("This employee is archived");

    expect(
      screen.queryByRole("button", { name: "Restore Employee" }),
    ).not.toBeInTheDocument();
  });
});
