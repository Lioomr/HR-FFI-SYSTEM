import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Modal } from "antd";

vi.mock("../../../../services/api/rentsApi", () => ({
  listRents: vi.fn().mockResolvedValue({
    status: "success",
    data: {
      items: [
        {
          id: 11,
          property_name_en: "Example Residence",
          property_name_ar: "سكن تجريبي",
          annual_rent_value: "12000.00",
        },
      ],
    },
  }),
}));
vi.mock("../../../../services/api/employeesApi", () => ({
  listEmployees: vi.fn().mockResolvedValue({
    status: "success",
    data: { results: [], count: 0 },
  }),
}));

import AccommodationAssignmentsPage from "./AccommodationAssignmentsPage";
import AccommodationReport from "../../../../components/payroll/AccommodationReport";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../../../services/api/payrollSettingsApi";
import { useAuthStore, type Role } from "../../../../auth/authStore";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";
import type { AccommodationAssignment } from "../../../../services/api/payrollTypes";

const FIND = { timeout: 8000 };
const en = (key: string) => resolveTranslation("en", key);

function signIn(role: Role) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "user@ffi.test", role },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AccommodationAssignmentsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  Modal.destroyAll();
  setPayrollMocksEnabled(undefined);
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe("AccommodationAssignmentsPage", () => {
  it("lets HR create, edit and delete", async () => {
    signIn("HRManager");
    renderPage();
    expect(
      await screen.findByText("Example Residence", {}, FIND),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: new RegExp(en("payroll.ui.newAssignment")),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en("payroll.ui.editAssignment") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en("payroll.ui.deleteAssignment") }),
    ).toBeInTheDocument();
  });

  it("is read-only for CFO with no row action buttons", async () => {
    signIn("CFO");
    renderPage();
    expect(
      await screen.findByText("Example Residence", {}, FIND),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(en("payroll.ui.newAssignment")),
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: en("payroll.ui.editAssignment") }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: en("payroll.ui.deleteAssignment") }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: en("payroll.ui.history") }),
    ).toBeNull();
    // Employee names are plain text for CFO (no HR profile route).
    expect(screen.queryByRole("link", { name: "Example Employee" })).toBeNull();
  });

  it("shows a 409 assignment_overlap clearly in the dialog", async () => {
    const state = payrollMockState();
    const overlapping: AccommodationAssignment = {
      ...state.assignments[0],
      id: 502,
      status: "none",
      rent_id: null,
      rent_name: null,
      start_date: "2026-10-01",
      end_date: "2026-10-31",
    };
    state.assignments.push(overlapping);
    signIn("HRManager");
    renderPage();
    await screen.findByText("Example Residence", {}, FIND);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: en("payroll.ui.editAssignment"),
      })[0],
    );
    const dialog = await screen.findByRole("dialog", {}, FIND);
    fireEvent.change(
      within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Correct dates" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: en("common.save") }),
    );
    expect(
      await within(dialog).findByText(
        /An accommodation assignment overlaps these dates\./,
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(en("payroll.ui.assignmentOverlapHelp")),
    ).toBeInTheDocument();
  });

  it("deletes only with a reason (soft delete)", async () => {
    signIn("HRManager");
    renderPage();
    await screen.findByText("Example Residence", {}, FIND);
    fireEvent.click(
      screen.getByRole("button", { name: en("payroll.ui.deleteAssignment") }),
    );
    const dialog = await screen.findByRole("dialog", {}, FIND);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en("payroll.ui.deleteAssignment"),
      }),
    );
    expect(
      await within(dialog).findByText(
        en("payroll.ui.reasonRequired"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().assignments[0].is_active).toBe(true);

    fireEvent.change(
      within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Assignment entered against the wrong property" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en("payroll.ui.deleteAssignment"),
      }),
    );
    await waitFor(() =>
      expect(payrollMockState().assignments[0].is_active).toBe(false),
    );
  });
});

describe("AccommodationReport", () => {
  it("shows the selected-window rent separately from the full monthly reference", async () => {
    signIn("HRManager");
    payrollMockState().accommodationReport[0].period_rent = {
      numerator: "12000.00",
      denominator: 24,
      decimal: "500.00",
    };
    render(
      <MemoryRouter>
        <AccommodationReport runId={7} refreshKey={0} />
      </MemoryRouter>,
    );

    await screen.findByText("Example Residence", {}, FIND);
    expect(
      screen.getAllByText(en("payroll.ui.periodRent")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(en("payroll.ui.monthlyRentReference")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("shows raw shares as approximations, rounded shares, not-in-payroll and the rounding difference", async () => {
    signIn("HRManager");
    render(
      <MemoryRouter>
        <AccommodationReport runId={7} refreshKey={0} />
      </MemoryRouter>,
    );
    await screen.findByText("Example Residence", {}, FIND);
    fireEvent.click(screen.getByRole("button", { name: "Expand row" }));
    expect(
      await screen.findByText("Example Nonpayroll Resident", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not in payroll").length).toBeGreaterThan(0);
    fireEvent.mouseOver(
      screen.getAllByRole("button", { name: en("payroll.ui.rawShare") })[0],
    );
    expect(
      (await screen.findAllByLabelText("Approximately 333.33", {}, FIND))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("333").length).toBe(3);
    expect(screen.getAllByText("Rounding difference")[0]).toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.rawReconciled")),
    ).toBeInTheDocument();
  });
});

it("requires both dates and a property only for assigned accommodation", async () => {
  signIn("HRManager");
  renderPage();
  await screen.findByText("Example Residence", {}, FIND);
  fireEvent.click(screen.getByRole("button", { name: /New assignment/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await within(dialog).findByText("Select a property.");
  expect(within(dialog).getAllByText("Select a date.")).toHaveLength(2);
  fireEvent.click(
    within(dialog).getByRole("radio", {
      name: en("payroll.accommodation_status.none"),
    }),
  );
  expect(
    within(dialog).queryByRole("combobox", { name: "Property" }),
  ).toBeNull();
  expect(payrollMockState().assignments).toHaveLength(1);
});

it("rejects an end date before the start date without writing", async () => {
  signIn("HRManager");
  renderPage();
  await screen.findByText("Example Residence", {}, FIND);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Edit assignment" })[0],
  );
  const dialog = await screen.findByRole("dialog");
  const end = within(dialog).getByLabelText("End date");
  fireEvent.focus(end);
  fireEvent.change(end, { target: { value: "2026-08-31" } });
  fireEvent.keyDown(end, { key: "Enter", code: "Enter", keyCode: 13 });
  fireEvent.blur(end);
  fireEvent.change(within(dialog).getByLabelText("Reason"), {
    target: { value: "Review dates" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(
    await within(dialog).findByText(
      en("payroll.validation.invalid_date_range"),
      {},
      FIND,
    ),
  ).toBeInTheDocument();
  expect(payrollMockState().assignments[0].end_date).not.toBe("2026-08-31");
});
