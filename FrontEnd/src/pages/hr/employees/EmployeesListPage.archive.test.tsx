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
}));

vi.mock("../../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
  exportEmployees: vi.fn(),
  listEmployeeArchiveRequests: vi.fn(),
  requestEmployeeArchive: vi.fn(),
  restoreEmployee: vi.fn(),
}));

vi.mock("../../../services/api/departmentsApi", () => ({
  listDepartments: vi.fn(),
}));

vi.mock("../../../services/api/preferencesApi", () => ({
  getUserPreference: vi.fn(),
  saveUserPreference: vi.fn(),
}));

vi.mock("../../../services/api/downloads", () => ({
  triggerBlobDownload: vi.fn(),
}));

import EmployeesListPage from "./EmployeesListPage";
import * as employeesApi from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
import * as departmentsApi from "../../../services/api/departmentsApi";
import * as preferencesApi from "../../../services/api/preferencesApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";
import { useHrEmployeeListStore } from "../../../stores/hrEmployeeListStore";

const listEmployees = employeesApi.listEmployees as unknown as ReturnType<
  typeof vi.fn
>;
const listEmployeeArchiveRequests =
  employeesApi.listEmployeeArchiveRequests as unknown as ReturnType<
    typeof vi.fn
  >;
const requestEmployeeArchive =
  employeesApi.requestEmployeeArchive as unknown as ReturnType<typeof vi.fn>;
const restoreEmployee = employeesApi.restoreEmployee as unknown as ReturnType<
  typeof vi.fn
>;
const listDepartments = departmentsApi.listDepartments as unknown as ReturnType<
  typeof vi.fn
>;
const getUserPreference =
  preferencesApi.getUserPreference as unknown as ReturnType<typeof vi.fn>;
const saveUserPreference =
  preferencesApi.saveUserPreference as unknown as ReturnType<typeof vi.fn>;

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1,
    employee_id: "FFI-0001",
    full_name: "Sara Ahmed",
    email: "sara@ffi.test",
    position: "Accountant",
    department: "Finance",
    nationality: "Saudi Arabia",
    hire_date: "2024-01-15",
    employment_status: "ACTIVE",
    is_archived: false,
    ...overrides,
  } as Employee;
}

/** The page reads employees from the paginated `results` envelope. */
function employeesResponse(items: Employee[]) {
  return {
    status: "success" as const,
    data: { results: items, count: items.length },
  };
}

/** Only the calls that carry `archive_state` come from the employee table itself. */
function tableCalls() {
  return listEmployees.mock.calls.filter(
    (call) => call[0] && "archive_state" in call[0],
  );
}

function latestTableCall() {
  const calls = tableCalls();
  return calls[calls.length - 1]?.[0];
}

const ARCHIVED_EMPLOYEE = makeEmployee({
  id: 7,
  full_name: "Omar Khalid",
  email: "omar@ffi.test",
  is_archived: true,
  archived_at: "2026-05-04T09:00:00Z",
  archived_by: 3,
  archived_by_name: "Archive Administrator",
  archive_reason: "RESIGNED",
});

/** Opens the row action dropdown for the given employee row. */
async function openRowMenu(fullName: string) {
  const row = screen.getByText(fullName).closest("tr") as HTMLElement;
  fireEvent.click(within(row).getByRole("button"));
  await screen.findByRole("menu");
}

beforeEach(() => {
  navigateMock.mockClear();
  listEmployees.mockReset();
  listEmployeeArchiveRequests.mockReset();
  requestEmployeeArchive.mockReset();
  restoreEmployee.mockReset();
  listDepartments.mockReset();
  getUserPreference.mockReset();
  saveUserPreference.mockReset();

  listDepartments.mockResolvedValue({ status: "success", data: [] });
  getUserPreference.mockResolvedValue({
    status: "error",
    message: "not found",
  });
  saveUserPreference.mockResolvedValue({ status: "success", data: {} });
  listEmployeeArchiveRequests.mockResolvedValue({
    status: "success",
    data: { items: [], count: 0, total_pages: 1 },
  });
  listEmployees.mockResolvedValue(employeesResponse([makeEmployee()]));

  useI18nStore.getState().setLanguage("en");
  useHrEmployeeListStore.getState().reset();
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("EmployeesListPage archive modal", () => {
  it("explains that the employee and their history are preserved", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    await openRowMenu("Sara Ahmed");
    fireEvent.click(screen.getByText("Request Archive"));

    expect(
      await screen.findByText("Request Employee Archive"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The employee stays in the system"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/preserving all linked records/i),
    ).toBeInTheDocument();
  });

  it("blocks submission until an archive reason and details are given", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    await openRowMenu("Sara Ahmed");
    fireEvent.click(screen.getByText("Request Archive"));
    await screen.findByText("Request Employee Archive");

    fireEvent.click(
      screen.getByRole("button", { name: "Submit for CEO Approval" }),
    );

    expect(
      await screen.findByText("An archive reason is required."),
    ).toBeInTheDocument();
    expect(screen.getByText("A reason is required.")).toBeInTheDocument();
    expect(requestEmployeeArchive).not.toHaveBeenCalled();
  });

  it("submits the selected archive reason with the request", async () => {
    requestEmployeeArchive.mockResolvedValue({
      status: "success",
      data: { id: 11 },
    });

    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    await openRowMenu("Sara Ahmed");
    fireEvent.click(screen.getByText("Request Archive"));
    await screen.findByText("Request Employee Archive");

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Archive reason" }),
    );
    fireEvent.click(await screen.findByTitle("End of contract"));

    fireEvent.change(screen.getByPlaceholderText(/Add details supporting/i), {
      target: { value: "Contract ended on 30 June." },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Submit for CEO Approval" }),
    );

    await waitFor(() =>
      expect(requestEmployeeArchive).toHaveBeenCalledTimes(1),
    );
    expect(requestEmployeeArchive).toHaveBeenCalledWith({
      employee_profile_id: 1,
      archive_reason: "END_OF_CONTRACT",
      reason: "Contract ended on 30 June.",
    });
  });

  it("surfaces the error envelope message when the request is rejected", async () => {
    requestEmployeeArchive.mockResolvedValue({
      status: "error",
      message: "An archive request is already pending for this employee.",
    });

    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    await openRowMenu("Sara Ahmed");
    fireEvent.click(screen.getByText("Request Archive"));
    await screen.findByText("Request Employee Archive");

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Archive reason" }),
    );
    fireEvent.click(await screen.findByTitle("Fired"));
    fireEvent.change(screen.getByPlaceholderText(/Add details supporting/i), {
      target: { value: "Policy breach." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for CEO Approval" }),
    );

    expect(
      await screen.findByText(
        "An archive request is already pending for this employee.",
      ),
    ).toBeInTheDocument();
  });
});

describe("EmployeesListPage archive filtering", () => {
  it("requests active employees by default", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    await waitFor(() => expect(tableCalls().length).toBeGreaterThan(0));
    expect(latestTableCall()).toMatchObject({ archive_state: "active" });
  });

  it("requests archived employees when the archived filter is selected", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    listEmployees.mockResolvedValue(employeesResponse([ARCHIVED_EMPLOYEE]));
    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));

    await waitFor(() =>
      expect(latestTableCall()).toMatchObject({ archive_state: "archived" }),
    );
    expect(await screen.findByText("Omar Khalid")).toBeInTheDocument();
  });

  it("hides the archive filter from roles that cannot list archived employees", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "2", email: "manager@ffi.test", role: "Manager" },
    });

    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    expect(
      screen.queryByRole("radio", { name: "Archived" }),
    ).not.toBeInTheDocument();
    expect(latestTableCall()).toMatchObject({ archive_state: "active" });
  });
});

describe("EmployeesListPage archived employee display", () => {
  beforeEach(() => {
    useHrEmployeeListStore.getState().setFilters({ archiveState: "archived" });
    listEmployees.mockResolvedValue(employeesResponse([ARCHIVED_EMPLOYEE]));
  });

  it("marks archived employees and shows their archive reason", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");

    const row = screen.getByText("Omar Khalid").closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByText("Resigned")).toBeInTheDocument();
  });

  it("shows who archived the employee", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");

    expect(
      screen.getByRole("columnheader", { name: "Archived By" }),
    ).toBeInTheDocument();
    const row = screen.getByText("Omar Khalid").closest("tr") as HTMLElement;
    expect(within(row).getByText("Archive Administrator")).toBeInTheDocument();
    // The raw archiver id is internal and must never reach the table.
    expect(within(row).queryByText("3")).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when the archiver name is absent", async () => {
    listEmployees.mockResolvedValue(
      employeesResponse([
        { ...ARCHIVED_EMPLOYEE, archived_by: null, archived_by_name: null },
      ]),
    );

    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");

    const row = screen.getByText("Omar Khalid").closest("tr") as HTMLElement;
    expect(
      within(row).queryByText("Archive Administrator"),
    ).not.toBeInTheDocument();
    expect(within(row).getAllByText("-").length).toBeGreaterThan(0);
  });

  it("omits archive metadata columns in the active view", async () => {
    useHrEmployeeListStore.getState().setFilters({ archiveState: "active" });
    listEmployees.mockResolvedValue(employeesResponse([makeEmployee()]));

    render(<EmployeesListPage />);
    await screen.findByText("Sara Ahmed");

    expect(
      screen.queryByRole("columnheader", { name: "Archived By" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Archive Reason" }),
    ).not.toBeInTheDocument();
  });

  it("offers restore instead of archive for an archived employee", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");

    await openRowMenu("Omar Khalid");

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Restore Employee")).toBeInTheDocument();
    expect(within(menu).queryByText("Request Archive")).not.toBeInTheDocument();
  });
});

describe("EmployeesListPage restore action", () => {
  beforeEach(() => {
    useHrEmployeeListStore.getState().setFilters({ archiveState: "archived" });
    listEmployees.mockResolvedValue(employeesResponse([ARCHIVED_EMPLOYEE]));
  });

  it("restores the employee and refreshes the list", async () => {
    restoreEmployee.mockResolvedValue({
      status: "success",
      data: {
        ...ARCHIVED_EMPLOYEE,
        is_archived: false,
        archive_reason: null,
        archived_at: null,
      },
    });

    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");
    const callsBeforeRestore = tableCalls().length;

    await openRowMenu("Omar Khalid");
    fireEvent.click(screen.getByText("Restore Employee"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Archived by:\s*Archive Administrator/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Restore Employee" }),
    );

    await waitFor(() => expect(restoreEmployee).toHaveBeenCalledWith(7));
    await waitFor(() =>
      expect(tableCalls().length).toBeGreaterThan(callsBeforeRestore),
    );
  });

  it("shows the backend message when a restore is not allowed", async () => {
    restoreEmployee.mockResolvedValue({
      status: "error",
      message: "Employee is not archived.",
    });

    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");

    await openRowMenu("Omar Khalid");
    fireEvent.click(screen.getByText("Restore Employee"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Restore Employee" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Employee is not archived.",
    );
  });

  it("hides the restore action from roles that cannot restore", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "2", email: "manager@ffi.test", role: "Manager" },
    });

    render(<EmployeesListPage />);
    await screen.findByText("Omar Khalid");

    await openRowMenu("Omar Khalid");
    expect(
      within(screen.getByRole("menu")).queryByText("Restore Employee"),
    ).not.toBeInTheDocument();
  });
});
