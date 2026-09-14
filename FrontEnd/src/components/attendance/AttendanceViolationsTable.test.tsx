import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import AttendanceViolationsTable from "./AttendanceViolationsTable";
import { useI18nStore } from "../../i18n/i18nStore";
import { restorePhoneViewport, setDesktopViewport } from "../../test/viewport";
import type { AttendanceLateViolation } from "../../types/attendancePolicy";

const violation = (
  overrides: Partial<AttendanceLateViolation> = {},
): AttendanceLateViolation => ({
  id: 58,
  employee_profile_id: 123,
  employee_code: "FFI-000123",
  employee_name: "Jane Doe",
  employee_name_en: "Jane Doe",
  employee_name_ar: "جين دو",
  date: "2026-09-13",
  occurrence_number: 2,
  daily_rate: "100.00",
  penalty_percent: "0.0500",
  penalty_amount: "5.00",
  lifecycle: "active",
  reason: "post_grace_late",
  void_reason: "",
  payroll_status: "pending",
  created_at: "2026-09-13T09:31:02+03:00",
  updated_at: "2026-09-13T09:31:02+03:00",
  ...overrides,
});

/** Final contract: a first occurrence has no payroll deduction and stays active. */
const warning = violation({
  id: 38,
  date: "2026-08-12",
  occurrence_number: 1,
  penalty_percent: "0.0000",
  penalty_amount: "0.00",
  payroll_status: null,
  reason: "outside_grace",
});
const monetary = violation();

function renderTable(showEmployee = false) {
  return render(
    <AttendanceViolationsTable
      items={[monetary, warning]}
      loading={false}
      page={1}
      pageSize={10}
      total={2}
      onPageChange={vi.fn()}
      showEmployee={showEmployee}
    />,
  );
}

/** The phone card (or desktop row) holding a violation's date. */
function rowFor(date: string) {
  const cell = screen.getByText(date);
  return (cell.closest("li") ?? cell.closest("tr")) as HTMLElement;
}

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  restorePhoneViewport();
});

describe("violation history lifecycle meaning", () => {
  it("explains a first-occurrence warning as having no payroll deduction", () => {
    renderTable();

    const warningCard = rowFor("2026-08-12");
    expect(
      within(warningCard).getByText("Warning only — no payroll deduction"),
    ).toBeInTheDocument();
    expect(
      within(warningCard).getByText("No payroll deduction"),
    ).toBeInTheDocument();
    expect(
      within(warningCard).queryByText("Recorded, awaiting payroll"),
    ).not.toBeInTheDocument();
    expect(within(warningCard).queryByText("Pending")).not.toBeInTheDocument();

    const monetaryCard = rowFor("2026-09-13");
    expect(
      within(monetaryCard).getByText("Recorded, awaiting payroll"),
    ).toBeInTheDocument();
    expect(within(monetaryCard).getByText("Pending")).toBeInTheDocument();
  });

  it("shows the same meaning in the desktop history table", () => {
    setDesktopViewport();
    renderTable();

    const warningRow = rowFor("2026-08-12");
    expect(warningRow.tagName).toBe("TR");
    expect(
      within(warningRow).getByText("Warning only — no payroll deduction"),
    ).toBeInTheDocument();
    expect(
      within(warningRow).queryByText("Recorded, awaiting payroll"),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor("2026-09-13")).getByText("Recorded, awaiting payroll"),
    ).toBeInTheDocument();
  });

  it("gives the HR table's lifecycle tooltip the warning meaning", async () => {
    renderTable(true);

    // HR cards are headed by employee, so find the warning card by its date.
    const warningItem = rowFor("2026-08-12");
    expect(warningItem.tagName).toBe("LI");
    expect(
      within(warningItem).getByText("No payroll deduction"),
    ).toBeInTheDocument();
    expect(within(warningItem).queryByText("Pending")).not.toBeInTheDocument();
    // The HR table has no meaning column; the lifecycle tooltip carries it.
    expect(
      screen.queryByText("Warning only — no payroll deduction"),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(within(warningItem).getByText("Active"));

    expect(
      await screen.findByText("Warning only — no payroll deduction"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Recorded, awaiting payroll"),
    ).not.toBeInTheDocument();
  });

  it("uses the Arabic warning meaning and payroll label", () => {
    useI18nStore.getState().setLanguage("ar");
    renderTable();

    const warningCard = rowFor("2026-08-12");
    expect(
      within(warningCard).getByText("إنذار فقط — دون خصم من الرواتب"),
    ).toBeInTheDocument();
    expect(
      within(warningCard).getByText("بدون خصم من الرواتب"),
    ).toBeInTheDocument();
    expect(
      within(warningCard).queryByText("مسجلة بانتظار الرواتب"),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor("2026-09-13")).getByText("مسجلة بانتظار الرواتب"),
    ).toBeInTheDocument();
  });
});
