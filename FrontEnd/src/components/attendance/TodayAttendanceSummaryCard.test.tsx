import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../services/api/attendanceApi", () => ({
  getTodayAttendanceSummary: vi.fn(),
}));

import TodayAttendanceSummaryCard from "./TodayAttendanceSummaryCard";
import { getTodayAttendanceSummary } from "../../services/api/attendanceApi";
import { useI18nStore } from "../../i18n/i18nStore";
import type {
  AttendanceDailyResult,
  AttendanceLateViolation,
} from "../../types/attendancePolicy";

const getSummary = vi.mocked(getTodayAttendanceSummary);

const violation = (
  overrides: Partial<AttendanceLateViolation> = {},
): AttendanceLateViolation => ({
  id: 41,
  employee_profile_id: 123,
  employee_code: "FFI-000123",
  employee_name: "Jane Doe",
  employee_name_en: "Jane Doe",
  employee_name_ar: null,
  date: "2026-09-13",
  occurrence_number: 2,
  daily_rate: "100.00",
  penalty_percent: "0.0500",
  penalty_amount: "5.00",
  lifecycle: "active",
  reason: "outside_grace",
  void_reason: "",
  payroll_status: "pending",
  created_at: "2026-09-13T09:31:02+03:00",
  updated_at: "2026-09-13T09:31:02+03:00",
  ...overrides,
});

/** First occurrence in the final contract: a zero warning with no deduction. */
const warning = () =>
  violation({
    occurrence_number: 1,
    penalty_percent: "0.0000",
    penalty_amount: "0.00",
    payroll_status: null,
  });

const summary = (
  overrides: Partial<AttendanceDailyResult> = {},
): AttendanceDailyResult => ({
  date: "2026-09-13",
  shift: {
    start_at: "2026-09-13T09:00:00+03:00",
    end_at: "2026-09-13T18:00:00+03:00",
    scheduled_minutes: 540,
  },
  first_check_in_at: "2026-09-13T09:30:00+03:00",
  final_check_out_at: "2026-09-13T18:00:00+03:00",
  physical_work_minutes: 510,
  unpaid_break_minutes: 0,
  approved_permission_minutes: 0,
  accounted_attendance_minutes: 510,
  missing_minutes: 30,
  status_input: "LATE",
  is_attendance_exempt: false,
  grace: { consumed: false, reason: "outside_grace" },
  violation: null,
  ...overrides,
});

const success = (data: AttendanceDailyResult) => ({
  status: "success" as const,
  data,
});
const failure = (status: number, message: string) => ({
  response: { status, data: { status: "error", message, detail: message } },
});

beforeEach(() => {
  getSummary.mockReset();
  useI18nStore.getState().setLanguage("en");
});

describe("TodayAttendanceSummaryCard", () => {
  it("shows a late day with its violation, penalty, lifecycle and payroll status", async () => {
    getSummary.mockResolvedValue(success(summary({ violation: violation() })));

    render(<TodayAttendanceSummaryCard />);

    expect(
      await screen.findByText("Late violation, occurrence #2"),
    ).toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(
      screen.getByText("Late: after the grace window"),
    ).toBeInTheDocument();
    expect(screen.getByText("5% of the daily rate")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Recorded, awaiting payroll")).toBeInTheDocument();
    // Shift window, punches, and the minute breakdown.
    expect(screen.getByText("09:30")).toBeInTheDocument();
    expect(screen.getAllByText("8 h 30 min")).toHaveLength(2);
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("(9 h 0 min)")).toBeInTheDocument();
  });

  it("calls occurrence 1 a warning with no payroll deduction", async () => {
    // Final contract: a first occurrence is "0.00", has no payroll deduction
    // (payroll_status null) and stays active until voided.
    getSummary.mockResolvedValue(success(summary({ violation: warning() })));

    render(<TodayAttendanceSummaryCard />);

    expect(
      await screen.findByText(
        "First occurrence: a warning only, with no deduction.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByText("Warning only — no payroll deduction"),
    ).toBeInTheDocument();
    expect(screen.getByText("No payroll deduction")).toBeInTheDocument();
    expect(
      screen.queryByText("Recorded, awaiting payroll"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/of the daily rate/)).not.toBeInTheDocument();
  });

  it("renders the warning-only state in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getSummary.mockResolvedValue(success(summary({ violation: warning() })));

    render(<TodayAttendanceSummaryCard />);

    expect(
      await screen.findByText("إنذار فقط — دون خصم من الرواتب"),
    ).toBeInTheDocument();
    expect(screen.getByText("بدون خصم من الرواتب")).toBeInTheDocument();
    expect(screen.queryByText("مسجلة بانتظار الرواتب")).not.toBeInTheDocument();
    expect(screen.queryByText("معلّقة")).not.toBeInTheDocument();
  });

  it("marks an exempt employee without a violation", async () => {
    getSummary.mockResolvedValue(
      success(
        summary({
          status_input: "PRESENT",
          is_attendance_exempt: true,
          grace: { consumed: false, reason: "attendance_exempt" },
          missing_minutes: 0,
        }),
      ),
    );

    render(<TodayAttendanceSummaryCard />);

    expect(await screen.findByText("Attendance exempt")).toBeInTheDocument();
    expect(screen.getByText("Present")).toBeInTheDocument();
    expect(
      screen.getByText("Exempt from attendance rules"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Late violation/)).not.toBeInTheDocument();
  });

  it("shows a day with no check-in", async () => {
    getSummary.mockResolvedValue(
      success(
        summary({
          status_input: "PRESENT",
          first_check_in_at: null,
          final_check_out_at: null,
          physical_work_minutes: 0,
          accounted_attendance_minutes: 0,
          missing_minutes: 540,
          grace: { consumed: false, reason: "no_check_in" },
        }),
      ),
    );

    render(<TodayAttendanceSummaryCard />);

    expect(await screen.findByText("No check-in recorded")).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
  });

  it("shows the unmapped-attendance notice for the BioTime 403", async () => {
    const text =
      "Attendance is unavailable until your BioTime mapping is completed. Contact HR to be registered on a BioTime device.";
    getSummary.mockRejectedValue(failure(403, text));

    render(<TodayAttendanceSummaryCard />);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(
      screen.queryByText(/Select your employee company/),
    ).not.toBeInTheDocument();
  });

  it("asks for a company on a company-context 403", async () => {
    getSummary.mockRejectedValue(
      failure(403, "Select an active company for this request."),
    );

    render(<TodayAttendanceSummaryCard />);

    expect(
      await screen.findByText(
        "Select your employee company to see today's attendance.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an empty state for a 404", async () => {
    getSummary.mockRejectedValue(failure(404, "Not found."));

    render(<TodayAttendanceSummaryCard />);

    expect(
      await screen.findByText(
        "No attendance summary is available for you in the selected company.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the summary in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getSummary.mockResolvedValue(success(summary({ violation: violation() })));

    render(<TodayAttendanceSummaryCard />);

    expect(await screen.findByText("حضور اليوم")).toBeInTheDocument();
    expect(screen.getByText("متأخر")).toBeInTheDocument();
    expect(screen.getByText("5% من الأجر اليومي")).toBeInTheDocument();
  });
});
