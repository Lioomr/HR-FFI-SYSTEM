import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "antd";
import dayjs from "dayjs";

vi.mock("../../services/api/attendanceApi", () => ({
  recalculateAttendance: vi.fn(),
}));
vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

import RecalculateAttendanceModal from "./RecalculateAttendanceModal";
import { recalculateAttendance } from "../../services/api/attendanceApi";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import type { AttendanceDailyResult } from "../../types/attendancePolicy";

const recalc = vi.mocked(recalculateAttendance);

const dailyResult = (date: string): AttendanceDailyResult => ({
  date,
  shift: {
    start_at: `${date}T09:00:00+03:00`,
    end_at: `${date}T18:00:00+03:00`,
    scheduled_minutes: 540,
  },
  first_check_in_at: `${date}T09:20:00+03:00`,
  final_check_out_at: `${date}T18:00:00+03:00`,
  physical_work_minutes: 520,
  unpaid_break_minutes: 0,
  approved_permission_minutes: 0,
  accounted_attendance_minutes: 520,
  missing_minutes: 20,
  status_input: "LATE",
  is_attendance_exempt: false,
  grace: { consumed: false, reason: "outside_grace" },
  violation: null,
});

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
}

async function confirmDialog() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Yes, recalculate" }),
  );
}

beforeEach(() => {
  recalc.mockReset();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(listEmployees).mockResolvedValue({
    status: "success",
    data: {
      results: [
        {
          id: 7,
          employee_id: "FFI-000007",
          full_name: "Jane Doe",
          full_name_en: "Jane Doe",
          email: "jane@ffi.test",
        } as Employee,
      ],
      count: 1,
    },
  });
});

afterEach(() => {
  Modal.destroyAll();
});

describe("HR attendance recalculation", () => {
  it("blocks a range longer than 31 days before calling the API", async () => {
    render(
      <RecalculateAttendanceModal
        open
        onClose={vi.fn()}
        initialValues={{
          employee_profile_id: 7,
          mode: "range",
          range: [dayjs("2026-08-01"), dayjs("2026-09-02")],
        }}
      />,
    );

    submit();

    expect(
      await screen.findByText(
        "The end date can be at most 31 days after the start date.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Recalculate attendance?"),
    ).not.toBeInTheDocument();
    expect(recalc).not.toHaveBeenCalled();
  });

  it("confirms, then reports an employee outside the company on a 404", async () => {
    recalc.mockRejectedValue({
      response: {
        status: 404,
        data: { status: "error", message: "Not found." },
      },
    });
    render(
      <RecalculateAttendanceModal
        open
        onClose={vi.fn()}
        initialValues={{
          employee_profile_id: 7,
          mode: "single",
          date: dayjs("2026-09-13"),
        }}
      />,
    );

    submit();
    await confirmDialog();

    // The confirm dialog, request and form update run asynchronously; allow
    // for a busy test runner.
    expect(
      await screen.findByText(
        "This employee is not in the selected company.",
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(recalc).toHaveBeenCalledWith({
      employee_profile_id: 7,
      date: "2026-09-13",
    });
  });

  it("sends an inclusive range and shows the returned daily results", async () => {
    const onRecalculated = vi.fn();
    recalc.mockResolvedValue({
      status: "success",
      data: { results: [dailyResult("2026-09-01"), dailyResult("2026-09-02")] },
    });
    render(
      <RecalculateAttendanceModal
        open
        onClose={vi.fn()}
        onRecalculated={onRecalculated}
        initialValues={{
          employee_profile_id: 7,
          mode: "range",
          range: [dayjs("2026-09-01"), dayjs("2026-09-02")],
        }}
      />,
    );

    submit();
    await confirmDialog();

    expect(await screen.findByText("Recalculated days")).toBeInTheDocument();
    expect(recalc).toHaveBeenCalledWith({
      employee_profile_id: 7,
      date_from: "2026-09-01",
      date_to: "2026-09-02",
    });
    expect(screen.getAllByText("20 min")).toHaveLength(2);
    expect(onRecalculated).toHaveBeenCalledTimes(1);
  });

  it("puts 422 date errors on the date field", async () => {
    recalc.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Range exceeds 31 days.",
          errors: [{ field: "date_to", message: "Range exceeds 31 days." }],
        },
      },
    });
    render(
      <RecalculateAttendanceModal
        open
        onClose={vi.fn()}
        initialValues={{
          employee_profile_id: 7,
          mode: "range",
          range: [dayjs("2026-09-01"), dayjs("2026-09-05")],
        }}
      />,
    );

    submit();
    await confirmDialog();

    const error = await screen.findByText("Range exceeds 31 days.", undefined, {
      timeout: 5000,
    });
    await waitFor(() =>
      expect(error.closest(".ant-form-item")).toHaveTextContent("Date range"),
    );
  });
});
