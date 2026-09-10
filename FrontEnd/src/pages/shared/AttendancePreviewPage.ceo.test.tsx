import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("../../services/api/attendanceApi", () => ({
  getCEOAttendance: vi.fn(),
  getGlobalAttendance: vi.fn(),
}));
vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi
    .fn()
    .mockResolvedValue({ status: "success", data: { results: [] } }),
}));
import AttendancePreviewPage from "./AttendancePreviewPage";
import {
  getCEOAttendance,
  getGlobalAttendance,
} from "../../services/api/attendanceApi";
import { useI18nStore } from "../../i18n/i18nStore";
beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});
describe("BioTime attendance read-only views", () => {
  it.each(["hr", "ceo"] as const)(
    "%s never offers mutations, including legacy pending records",
    async (role) => {
      const read = role === "hr" ? getGlobalAttendance : getCEOAttendance;
      vi.mocked(read).mockResolvedValue({
        status: "success",
        data: {
          results: [
            {
              id: 1,
              employee_name: "Sara Ahmed",
              date: "2026-09-01",
              status: "PENDING_CEO",
              source: "SYSTEM",
            },
          ],
          count: 1,
        },
      } as never);
      render(<AttendancePreviewPage role={role} />);
      expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
      expect(
        screen.getByText("Attendance is recorded through BioTime."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /approve|reject|edit|override|correct/i,
        }),
      ).not.toBeInTheDocument();
      expect(
        role === "hr" ? getCEOAttendance : getGlobalAttendance,
      ).not.toHaveBeenCalled();
    },
  );
});
