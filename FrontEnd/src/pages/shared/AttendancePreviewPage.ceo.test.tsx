import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../services/api/attendanceApi", () => ({
  getCEOAttendance: vi.fn(),
  getGlobalAttendance: vi.fn(),
  approveCEOAttendance: vi.fn(),
  rejectCEOAttendance: vi.fn(),
}));

import AttendancePreviewPage from "./AttendancePreviewPage";
import * as attendanceApi from "../../services/api/attendanceApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getCEOAttendance =
  attendanceApi.getCEOAttendance as unknown as ReturnType<typeof vi.fn>;
const getGlobalAttendance =
  attendanceApi.getGlobalAttendance as unknown as ReturnType<typeof vi.fn>;
const approveCEOAttendance =
  attendanceApi.approveCEOAttendance as unknown as ReturnType<typeof vi.fn>;
const rejectCEOAttendance =
  attendanceApi.rejectCEOAttendance as unknown as ReturnType<typeof vi.fn>;

const pendingRow = {
  id: 21,
  employee_profile: 7,
  employee_name_en: "Sara Ahmed",
  employee_name: "Sara Ahmed",
  employee_email: "sara@ffi.test",
  date: "2026-08-01",
  check_in_at: null,
  check_out_at: null,
  status: "PENDING_CEO",
  source: "EMPLOYEE",
};

const settledRow = { ...pendingRow, id: 22, status: "PRESENT" };

const listing = (rows: unknown[]) => ({
  status: "success" as const,
  data: { results: rows, count: rows.length, summary: {} },
});

beforeEach(() => {
  [
    getCEOAttendance,
    getGlobalAttendance,
    approveCEOAttendance,
    rejectCEOAttendance,
  ].forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("AttendancePreviewPage (CEO)", () => {
  it("offers a decision only on rows waiting on the CEO", async () => {
    getCEOAttendance.mockResolvedValue(listing([pendingRow, settledRow]));

    render(<AttendancePreviewPage role="ceo" />);

    expect(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject: Sara Ahmed" }),
    ).toBeInTheDocument();
    // The settled row states in words that nothing is required of the CEO.
    expect(screen.getByText("No action needed")).toBeInTheDocument();
  });

  it("approves a pending record and reloads", async () => {
    getCEOAttendance.mockResolvedValue(listing([pendingRow]));
    approveCEOAttendance.mockResolvedValue({
      status: "success" as const,
      data: pendingRow,
    });

    render(<AttendancePreviewPage role="ceo" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    );

    await waitFor(() =>
      expect(approveCEOAttendance).toHaveBeenCalledWith(21, {}),
    );
    await waitFor(() => expect(getCEOAttendance).toHaveBeenCalledTimes(2));
  });

  it("requires a reason before rejecting", async () => {
    getCEOAttendance.mockResolvedValue(listing([pendingRow]));
    rejectCEOAttendance.mockResolvedValue({
      status: "success" as const,
      data: pendingRow,
    });

    render(<AttendancePreviewPage role="ceo" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject: Sara Ahmed" }),
    );
    expect(
      await screen.findByText("Reject attendance record"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(
      await screen.findByText("A rejection reason is required."),
    ).toBeInTheDocument();
    expect(rejectCEOAttendance).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), {
      target: { value: "Not supported by the log" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(rejectCEOAttendance).toHaveBeenCalledWith(21, {
        notes: "Not supported by the log",
      }),
    );
  });

  it("leaves the HR view read-only", async () => {
    getGlobalAttendance.mockResolvedValue(listing([pendingRow]));

    render(<AttendancePreviewPage role="hr" />);

    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Approve/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Reject/ }),
    ).not.toBeInTheDocument();
    expect(getCEOAttendance).not.toHaveBeenCalled();
  });
});
