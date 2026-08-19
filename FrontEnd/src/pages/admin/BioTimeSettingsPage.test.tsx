import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../../services/api/bioTimeApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/api/bioTimeApi")
  >("../../services/api/bioTimeApi");
  return {
    ...actual,
    bioTimeApi: {
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
      testConnection: vi.fn(),
      syncNow: vi.fn(),
      getMappings: vi.fn(),
      createMapping: vi.fn(),
      deleteMapping: vi.fn(),
      getUnmappedUsers: vi.fn(),
    },
  };
});

vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

import BioTimeSettingsPage from "./BioTimeSettingsPage";
import { bioTimeApi } from "../../services/api/bioTimeApi";
import type {
  BioTimeEmployeeMap,
  UnmappedBioTimeUser,
} from "../../services/api/bioTimeApi";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getConfig = bioTimeApi.getConfig as unknown as ReturnType<typeof vi.fn>;
const updateConfig = bioTimeApi.updateConfig as unknown as ReturnType<
  typeof vi.fn
>;
const syncNow = bioTimeApi.syncNow as unknown as ReturnType<typeof vi.fn>;
const getMappings = bioTimeApi.getMappings as unknown as ReturnType<
  typeof vi.fn
>;
const createMapping = bioTimeApi.createMapping as unknown as ReturnType<
  typeof vi.fn
>;
const deleteMapping = bioTimeApi.deleteMapping as unknown as ReturnType<
  typeof vi.fn
>;
const getUnmappedUsers = bioTimeApi.getUnmappedUsers as unknown as ReturnType<
  typeof vi.fn
>;
const listEmployeesMock = listEmployees as unknown as ReturnType<typeof vi.fn>;

const config = {
  server_ip: "192.168.1.250",
  server_port: "80",
  username: "admin",
  is_active: true,
  last_sync_time: "2026-08-12T06:00:00Z",
};

const mapping = (
  overrides: Partial<BioTimeEmployeeMap> = {},
): BioTimeEmployeeMap => ({
  id: 1,
  employee_profile: 42,
  employee_name: "Sara Ali",
  department: "Finance",
  biotime_emp_code: "100001",
  created_at: "2026-08-01T09:00:00Z",
  ...overrides,
});

const unmapped = (
  overrides: Partial<UnmappedBioTimeUser> = {},
): UnmappedBioTimeUser => ({
  emp_code: "100002",
  first_name: "Omar",
  last_name: "Nasser",
  department: "Operations",
  ...overrides,
});

const page = <T,>(
  items: T[],
  count = items.length,
  pageNumber = 1,
  pageSize = 25,
) => ({
  items,
  page: pageNumber,
  page_size: pageSize,
  count,
  total_pages: Math.max(1, Math.ceil(count / pageSize)),
});

const employee = (overrides: Partial<Employee> = {}): Employee =>
  ({
    id: 42,
    employee_id: "FFI-042",
    user_id: 9,
    full_name: "Sara Ali",
    full_name_en: "Sara Ali",
    email: "sara@ffi.test",
    employee_number: "E-042",
    ...overrides,
  }) as Employee;

const employeesResponse = (items: Employee[]) => ({
  status: "success" as const,
  data: { results: items, count: items.length },
});

const descriptionValue = (card: HTMLElement, label: string) =>
  within(card)
    .getByText(label)
    .closest("th")
    ?.nextElementSibling?.textContent?.trim();

const employeeSelect = (table: HTMLElement) =>
  within(table).getByRole("combobox", { name: "Map to HR Employee" });

const openMappingTab = async () => {
  fireEvent.click(screen.getByRole("tab", { name: "Employee Mapping" }));
  await waitFor(() =>
    expect(screen.getByText("Unmapped Device Users")).toBeInTheDocument(),
  );
};

beforeEach(() => {
  getConfig.mockReset();
  updateConfig.mockReset();
  syncNow.mockReset();
  getMappings.mockReset();
  createMapping.mockReset();
  deleteMapping.mockReset();
  getUnmappedUsers.mockReset();
  listEmployeesMock.mockReset();

  useI18nStore.getState().setLanguage("en");

  getConfig.mockResolvedValue(config);
  updateConfig.mockResolvedValue(config);
  getMappings.mockResolvedValue(page([mapping()]));
  getUnmappedUsers.mockResolvedValue(page([unmapped()]));
  listEmployeesMock.mockResolvedValue(employeesResponse([employee()]));
});

describe("BioTimeSettingsPage config", () => {
  it("loads the config from the envelope data and keeps the password blank", async () => {
    render(<BioTimeSettingsPage />);

    expect(
      await screen.findByDisplayValue("192.168.1.250"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("80")).toBeInTheDocument();
    expect(screen.getByDisplayValue("admin")).toBeInTheDocument();

    const password = screen.getByLabelText("API Password") as HTMLInputElement;
    expect(password.value).toBe("");
  });

  it("omits the password when the field was left blank", async () => {
    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateConfig).toHaveBeenCalled());
    expect(updateConfig.mock.calls[0][0]).toEqual({
      server_ip: "192.168.1.250",
      server_port: "80",
      username: "admin",
      is_active: true,
    });
    expect(updateConfig.mock.calls[0][0]).not.toHaveProperty("password");
  });

  it("sends the password only when one was entered", async () => {
    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");

    fireEvent.change(screen.getByLabelText("API Password"), {
      target: { value: "new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateConfig).toHaveBeenCalled());
    expect(updateConfig.mock.calls[0][0].password).toBe("new-secret");
  });

  it("shows a retryable error when the config request fails", async () => {
    getConfig.mockRejectedValueOnce(new Error("boom"));

    render(<BioTimeSettingsPage />);

    expect(await screen.findByText("boom")).toBeInTheDocument();

    getConfig.mockResolvedValue(config);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(
      await screen.findByDisplayValue("192.168.1.250"),
    ).toBeInTheDocument();
  });
});

describe("BioTimeSettingsPage sync", () => {
  it("sends the default days_back of 7 and renders the result summary", async () => {
    syncNow.mockResolvedValue({
      message: "BioTime sync completed.",
      summary: {
        processed: 12,
        created: 4,
        updated: 3,
        skipped: 2,
        unmapped: 2,
        invalid: 1,
      },
    });

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");

    fireEvent.click(screen.getByRole("button", { name: /Sync Now/ }));

    await waitFor(() => expect(syncNow).toHaveBeenCalledWith(7));

    const summary = await screen.findByText("Last Sync Result");
    const card = summary.closest(".ant-descriptions") as HTMLElement;
    expect(descriptionValue(card, "Processed")).toBe("12");
    expect(descriptionValue(card, "Created")).toBe("4");
    expect(descriptionValue(card, "Updated")).toBe("3");
    expect(descriptionValue(card, "Skipped")).toBe("2");
    expect(descriptionValue(card, "Unmapped")).toBe("2");
    expect(descriptionValue(card, "Invalid")).toBe("1");
  });

  it("sends the days_back value chosen by the user", async () => {
    syncNow.mockResolvedValue({
      message: "BioTime sync completed.",
      summary: {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        unmapped: 0,
        invalid: 0,
      },
    });

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");

    const daysInput = screen.getByLabelText("Days to sync back");
    fireEvent.change(daysInput, { target: { value: "30" } });
    fireEvent.blur(daysInput);
    fireEvent.click(screen.getByRole("button", { name: /Sync Now/ }));

    await waitFor(() => expect(syncNow).toHaveBeenCalledWith(30));
  });

  it("shows the last sync time reloaded after a successful sync", async () => {
    syncNow.mockResolvedValue({
      message: "BioTime sync completed.",
      summary: {
        processed: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        unmapped: 0,
        invalid: 0,
      },
    });
    getConfig.mockResolvedValueOnce(config).mockResolvedValueOnce({
      ...config,
      last_sync_time: "2026-08-12T10:30:00Z",
    });

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    expect(screen.getByText(/Last sync: 2026-08-12 09:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sync Now/ }));

    expect(
      await screen.findByText(/Last sync: 2026-08-12 13:30/),
    ).toBeInTheDocument();
  });
});

describe("BioTimeSettingsPage mappings", () => {
  it("renders device users with code, name and department from data.items", async () => {
    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    expect(screen.getByText("100002")).toBeInTheDocument();
    expect(screen.getByText("Omar Nasser")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();

    expect(screen.getByText("100001")).toBeInTheDocument();
    expect(screen.getByText("Sara Ali")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("requests the next page of mappings when pagination changes", async () => {
    getMappings.mockResolvedValue(page([mapping()], 60));

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    await waitFor(() =>
      expect(getMappings).toHaveBeenCalledWith({ page: 1, page_size: 25 }),
    );

    const mappedTable = screen
      .getByText("Sara Ali")
      .closest(".ant-table-wrapper") as HTMLElement;
    fireEvent.click(within(mappedTable).getByTitle("2"));

    await waitFor(() =>
      expect(getMappings).toHaveBeenCalledWith({ page: 2, page_size: 25 }),
    );
  });

  it("requests the next page of unmapped device users when pagination changes", async () => {
    getUnmappedUsers.mockResolvedValue(page([unmapped()], 60));

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    await waitFor(() =>
      expect(getUnmappedUsers).toHaveBeenCalledWith({ page: 1, page_size: 25 }),
    );

    const unmappedTable = screen
      .getByText("Omar Nasser")
      .closest(".ant-table-wrapper") as HTMLElement;
    fireEvent.click(within(unmappedTable).getByTitle("2"));

    await waitFor(() =>
      expect(getUnmappedUsers).toHaveBeenCalledWith({ page: 2, page_size: 25 }),
    );
  });

  it("surfaces the backend error message when linking fails", async () => {
    createMapping.mockRejectedValue({
      apiData: {
        status: "error",
        message: "Validation error",
        errors: {
          employee_profile: ["Employee already has a BioTime mapping."],
        },
      },
    });
    listEmployeesMock.mockResolvedValue(
      employeesResponse([employee({ id: 77, employee_number: "E-077" })]),
    );

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    const unmappedTable = screen
      .getByText("Omar Nasser")
      .closest(".ant-table-wrapper") as HTMLElement;
    fireEvent.mouseDown(employeeSelect(unmappedTable));
    fireEvent.click(await screen.findByTitle("E-077 - Sara Ali"));
    fireEvent.click(
      within(unmappedTable).getByRole("button", { name: "Link" }),
    );

    await waitFor(() =>
      expect(createMapping).toHaveBeenCalledWith({
        biotime_emp_code: "100002",
        employee_profile: 77,
      }),
    );
    expect(
      await screen.findByText("Employee already has a BioTime mapping."),
    ).toBeInTheDocument();
  });

  it("refreshes both tables after a successful link", async () => {
    createMapping.mockResolvedValue(mapping({ id: 9, employee_profile: 77 }));
    listEmployeesMock.mockResolvedValue(
      employeesResponse([employee({ id: 77, employee_number: "E-077" })]),
    );

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    const mappingCallsBefore = getMappings.mock.calls.length;
    const unmappedCallsBefore = getUnmappedUsers.mock.calls.length;

    const unmappedTable = screen
      .getByText("Omar Nasser")
      .closest(".ant-table-wrapper") as HTMLElement;
    fireEvent.mouseDown(employeeSelect(unmappedTable));
    fireEvent.click(await screen.findByTitle("E-077 - Sara Ali"));
    fireEvent.click(
      within(unmappedTable).getByRole("button", { name: "Link" }),
    );

    await waitFor(() => {
      expect(getMappings.mock.calls.length).toBeGreaterThan(mappingCallsBefore);
      expect(getUnmappedUsers.mock.calls.length).toBeGreaterThan(
        unmappedCallsBefore,
      );
    });
  });

  it("disables employees that are already mapped", async () => {
    listEmployeesMock.mockResolvedValue(
      employeesResponse([
        employee({ id: 42, employee_number: "E-042" }),
        employee({ id: 77, employee_number: "E-077" }),
      ]),
    );

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    const unmappedTable = screen
      .getByText("Omar Nasser")
      .closest(".ant-table-wrapper") as HTMLElement;
    fireEvent.mouseDown(employeeSelect(unmappedTable));

    // Employee 42 is already mapped to device code 100001.
    const mappedOption = await screen.findByTitle("E-042 - Sara Ali");
    expect(mappedOption.closest(".ant-select-item-option")).toHaveClass(
      "ant-select-item-option-disabled",
    );
    const freeOption = await screen.findByTitle("E-077 - Sara Ali");
    expect(freeOption.closest(".ant-select-item-option")).not.toHaveClass(
      "ant-select-item-option-disabled",
    );
  });

  it("asks for confirmation before unlinking and refreshes afterwards", async () => {
    deleteMapping.mockResolvedValue(undefined);

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));

    expect(await screen.findByText("Remove this mapping?")).toBeInTheDocument();
    expect(deleteMapping).not.toHaveBeenCalled();

    const popover = screen
      .getByText("Remove this mapping?")
      .closest(".ant-popover") as HTMLElement;
    fireEvent.click(within(popover).getByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(deleteMapping).toHaveBeenCalledWith(1));
  });

  it("shows a retryable error when the device user list cannot be loaded", async () => {
    getUnmappedUsers.mockRejectedValue(
      new Error("Unable to load BioTime employees."),
    );

    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    fireEvent.click(screen.getByRole("tab", { name: "Employee Mapping" }));

    expect(
      await screen.findByText("Unable to load BioTime employees."),
    ).toBeInTheDocument();
  });

  it("searches HR employees on the server", async () => {
    render(<BioTimeSettingsPage />);
    await screen.findByDisplayValue("192.168.1.250");
    await openMappingTab();

    fireEvent.change(screen.getByPlaceholderText("Search HR employees"), {
      target: { value: "omar" },
    });

    await waitFor(() =>
      expect(listEmployeesMock).toHaveBeenCalledWith({
        search: "omar",
        page_size: 50,
      }),
    );
  });
});
