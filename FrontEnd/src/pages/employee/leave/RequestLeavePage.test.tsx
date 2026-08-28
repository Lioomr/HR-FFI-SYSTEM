import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import dayjs from "dayjs";

vi.mock("../../../services/api/leaveApi", () => ({
  getLeaveTypes: vi.fn().mockResolvedValue({ status: "success", data: [] }),
  getMyLeaveBalance: vi.fn().mockResolvedValue({ status: "success", data: [] }),
  createLeaveRequest: vi.fn(),
}));

vi.mock("../../../services/api/employeesApi", () => ({
  listDelegationCandidates: vi
    .fn()
    .mockResolvedValue({ status: "success", data: [] }),
}));

import RequestLeavePage, { LeaveSubmissionError } from "./RequestLeavePage";
import {
  getLeaveValidationErrors,
  isEmployeeLeaveDateDisabled,
} from "./leaveRequestValidation";
import { useI18nStore } from "../../../i18n/i18nStore";

const today = dayjs("2026-08-11");

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
});

describe("employee leave backdated dates", () => {
  it("enables exactly 7 days ago", () => {
    expect(isEmployeeLeaveDateDisabled(today.subtract(7, "day"), today)).toBe(
      false,
    );
  });

  it("disables 8 days ago", () => {
    expect(isEmployeeLeaveDateDisabled(today.subtract(8, "day"), today)).toBe(
      true,
    );
  });

  it("enables today", () => {
    expect(isEmployeeLeaveDateDisabled(today, today)).toBe(false);
  });

  it("enables future dates", () => {
    expect(isEmployeeLeaveDateDisabled(today.add(30, "day"), today)).toBe(
      false,
    );
  });

  it("renders the translated helper text", async () => {
    render(
      <MemoryRouter>
        <RequestLeavePage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "Leave can be submitted up to 7 calendar days after it starts.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the backend start-date validation error clearly", () => {
    const error = {
      apiData: {
        errors: [
          "start_date: Leave can be submitted up to 7 calendar days after it starts.",
        ],
      },
    };
    const [validationError] = getLeaveValidationErrors(error);

    render(<LeaveSubmissionError message={validationError?.message || null} />);

    expect(validationError?.field).toBe("start_date");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Leave can be submitted up to 7 calendar days after it starts.",
    );
  });
});
