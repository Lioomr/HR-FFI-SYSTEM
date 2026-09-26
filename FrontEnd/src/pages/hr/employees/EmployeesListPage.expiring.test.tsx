import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import dayjs from "dayjs";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
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
import type {
  Employee,
  ListEmployeesParams,
} from "../../../services/api/employeesApi";
import * as departmentsApi from "../../../services/api/departmentsApi";
import * as preferencesApi from "../../../services/api/preferencesApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";
import { useHrEmployeeListStore } from "../../../stores/hrEmployeeListStore";
import {
  restorePhoneViewport,
  setDesktopViewport,
} from "../../../test/viewport";

const listEmployees = vi.mocked(employeesApi.listEmployees);
const exportEmployees = vi.mocked(employeesApi.exportEmployees);

const EXPAT = {
  id: 1,
  employee_id: "FFI-0001",
  full_name: "Ravi Kumar",
  email: "ravi@ffi.test",
  nationality: "India",
  is_saudi: false,
  id_expiry: dayjs().add(12, "day").format("YYYY-MM-DD"),
  contract_expiry: dayjs().subtract(3, "day").format("YYYY-MM-DD"),
  employment_status: "ACTIVE",
  is_archived: false,
} as Employee;

/** Requests for the table carry the page size; chip counts ask for one row. */
function tableCalls(): ListEmployeesParams[] {
  return listEmployees.mock.calls
    .map((call) => call[0] as ListEmployeesParams)
    .filter((params) => params?.archive_state && params.page_size !== 1);
}

beforeEach(() => {
  listEmployees.mockReset();
  exportEmployees.mockReset();
  vi.mocked(employeesApi.listEmployeeArchiveRequests).mockResolvedValue({
    status: "success",
    data: { items: [], count: 0, total_pages: 1 },
  } as never);
  vi.mocked(departmentsApi.listDepartments).mockResolvedValue({
    status: "success",
    data: [],
  } as never);
  vi.mocked(preferencesApi.getUserPreference).mockResolvedValue({
    status: "error",
    message: "not found",
  } as never);
  vi.mocked(preferencesApi.saveUserPreference).mockResolvedValue({
    status: "success",
    data: {},
  } as never);
  listEmployees.mockImplementation(async (params?: ListEmployeesParams) => {
    if (params?.page_size === 1 && params.expiring) {
      return {
        status: "success",
        data: { results: [], count: params.expiring === "iqama" ? 4 : 2 },
      } as never;
    }
    return { status: "success", data: { results: [EXPAT], count: 1 } } as never;
  });

  useI18nStore.getState().setLanguage("en");
  useHrEmployeeListStore.getState().reset();
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
  setDesktopViewport();
});

afterEach(() => {
  restorePhoneViewport();
});

describe("EmployeesListPage expiry quick views", () => {
  it("shows counts on the Iqama and contract chips", async () => {
    render(<EmployeesListPage />);
    const views = await screen.findByRole("group", { name: "Quick views" });

    await waitFor(() =>
      expect(
        within(views).getByRole("button", { name: /Iqama expiring/ }),
      ).toHaveTextContent("4"),
    );
    expect(
      within(views).getByRole("button", { name: /Contract expiring/ }),
    ).toHaveTextContent("2");
    expect(
      within(views).getByRole("button", { name: /All employees/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("filters by Iqama expiry and shows the expiry column", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Ravi Kumar");

    const iqama = screen.getByRole("button", { name: /Iqama expiring/ });
    fireEvent.click(iqama);

    await waitFor(() =>
      expect(tableCalls().at(-1)).toMatchObject({
        expiring: "iqama",
        expiring_days: 30,
        archive_state: "active",
      }),
    );
    expect(iqama).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByRole("columnheader", { name: "Iqama expiry" }),
    ).toBeInTheDocument();
    expect(screen.getByText("In 12 days")).toBeInTheDocument();

    // Clicking the active chip again returns to all employees.
    fireEvent.click(iqama);
    await waitFor(() => expect(tableCalls().at(-1)?.expiring).toBeUndefined());
  });

  it("uses the chosen window and marks expired contracts", async () => {
    render(<EmployeesListPage />);
    await screen.findByText("Ravi Kumar");

    fireEvent.click(screen.getByRole("button", { name: /Contract expiring/ }));
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Within 30 days" }),
    );
    fireEvent.click(await screen.findByTitle("Within 90 days"));

    await waitFor(() =>
      expect(tableCalls().at(-1)).toMatchObject({
        expiring: "contract",
        expiring_days: 90,
      }),
    );
    expect(await screen.findByText("Expired 3 days ago")).toBeInTheDocument();
  });

  it("exports with the active quick view", async () => {
    exportEmployees.mockResolvedValue(new Blob());
    render(<EmployeesListPage />);
    await screen.findByText("Ravi Kumar");

    fireEvent.click(screen.getByRole("button", { name: /Iqama expiring/ }));
    await waitFor(() => expect(tableCalls().at(-1)?.expiring).toBe("iqama"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(exportEmployees).toHaveBeenCalledWith(
        expect.objectContaining({ expiring: "iqama", expiring_days: 30 }),
      ),
    );
  });
});
