import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "7" }),
}));

vi.mock("../../../services/api/employeesApi", () => ({
  getEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  listManagerOptions: vi.fn(),
}));

vi.mock("../../../services/api/departmentsApi", () => ({
  listDepartments: vi.fn().mockResolvedValue({
    status: "success",
    data: [{ id: 1, name: "Operations" }],
  }),
}));
vi.mock("../../../services/api/positionsApi", () => ({
  listPositions: vi.fn().mockResolvedValue({
    status: "success",
    data: [{ id: 2, name: "Technician" }],
  }),
}));
vi.mock("../../../services/api/taskGroupsApi", () => ({
  listTaskGroups: vi.fn().mockResolvedValue({ status: "success", data: [] }),
}));
vi.mock("../../../services/api/sponsorsApi", () => ({
  listSponsors: vi.fn().mockResolvedValue({ status: "success", data: [] }),
}));

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("../../../services/api/apiClient", () => ({
  api: { get: vi.fn(), post: apiPost, patch: vi.fn(), put: vi.fn() },
}));

vi.mock("../../../utils/notify", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

import EditEmployeePage from "./EditEmployeePage";
import * as employeesApi from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const getEmployee = employeesApi.getEmployee as unknown as ReturnType<
  typeof vi.fn
>;
const updateEmployee = employeesApi.updateEmployee as unknown as ReturnType<
  typeof vi.fn
>;
const listManagerOptions =
  employeesApi.listManagerOptions as unknown as ReturnType<typeof vi.fn>;

const EMPLOYEE = {
  id: 7,
  employee_id: "FFI-0007",
  full_name: "Omar Khalid",
  full_name_en: "Omar Khalid",
  email: "omar@ffi.test",
  company_id: 5,
  department_id: 1,
  position_id: 2,
  join_date: "2024-01-01",
  is_archived: false,
  manager_profile_id: 40,
  manager_profile_name: "Saved Manager",
} as unknown as Employee;

beforeEach(() => {
  navigateMock.mockClear();
  apiPost.mockClear();
  getEmployee.mockReset();
  getEmployee.mockResolvedValue({ status: "success", data: EMPLOYEE });
  updateEmployee.mockReset();
  updateEmployee.mockResolvedValue({ status: "success", data: EMPLOYEE });
  listManagerOptions.mockReset();
  listManagerOptions.mockResolvedValue({
    status: "success",
    data: {
      items: [
        {
          id: 41,
          employee_id: "FFI-0041",
          full_name: "New Manager",
          full_name_en: "New Manager",
          full_name_ar: "",
        },
      ],
      page: 1,
      page_size: 20,
      count: 1,
      total_pages: 1,
    },
  });
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "1",
      email: "hr@ffi.test",
      role: "HRManager",
      active_organization_id: 5,
    },
  });
});

async function renderPage() {
  const view = render(<EditEmployeePage />);
  fireEvent.click(
    await screen.findByRole("tab", { name: /Employment Information/ }),
  );
  return view;
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
}

describe("EditEmployeePage single manager", () => {
  it("preselects the saved manager by name only", async () => {
    await renderPage();

    expect(await screen.findByText("Saved Manager")).toBeInTheDocument();
    expect(screen.queryByText(/cross-company/i)).not.toBeInTheDocument();
  });

  it("sends only manager_profile_id for a newly picked manager", async () => {
    await renderPage();

    const input = document.querySelector<HTMLInputElement>(
      "#manager_profile_id",
    )!;
    fireEvent.mouseDown(input);
    fireEvent.click(await screen.findByTitle("New Manager (FFI-0041)"));
    save();

    await waitFor(() => expect(updateEmployee).toHaveBeenCalledTimes(1));
    const [id, payload] = updateEmployee.mock.calls[0];
    expect(id).toBe("7");
    expect(payload.manager_profile_id).toBe(41);
    for (const key of Object.keys(payload)) {
      expect(key).not.toMatch(/cross_company|scope|end_at|start_at|capabilit/);
    }
    // The old two-step cross-company assignment call is gone.
    expect(apiPost).not.toHaveBeenCalled();
    expect(listManagerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ employee_profile_id: "7" }),
    );
  });

  it("sends null when the manager is cleared", async () => {
    await renderPage();
    await screen.findByText("Saved Manager");

    const clear = document
      .querySelector("#manager_profile_id")!
      .closest(".ant-select")!
      .querySelector(".ant-select-clear")!;
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    save();

    await waitFor(() => expect(updateEmployee).toHaveBeenCalledTimes(1));
    expect(updateEmployee.mock.calls[0][1].manager_profile_id).toBeNull();
  });

  it("shows a 422 manager_profile_id rejection on the field", async () => {
    updateEmployee.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation error",
          errors: [
            {
              field: "manager_profile_id",
              message: "Manager assignment cannot create a reporting cycle.",
            },
          ],
        },
      },
    });
    await renderPage();
    save();

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((alert) =>
            alert.textContent?.includes(
              "Manager assignment cannot create a reporting cycle.",
            ),
          ),
      ).toBe(true),
    );
    expect(navigateMock).not.toHaveBeenCalledWith("/hr/employees/7");
  });
});
