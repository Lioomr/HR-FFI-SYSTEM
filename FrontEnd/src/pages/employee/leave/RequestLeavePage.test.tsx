import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import dayjs from "dayjs";

vi.mock("../../../services/api/leaveApi", () => ({
  getLeaveTypes: vi.fn().mockResolvedValue({ status: "success", data: [] }),
  getMyLeaveBalance: vi.fn().mockResolvedValue({ status: "success", data: [] }),
  createLeaveRequest: vi.fn(),
}));

vi.mock("../../../services/api/employeesApi", () => ({
  getEmployee: vi.fn().mockResolvedValue({
    status: "success",
    data: { id: 1, is_saudi: false, nationality: "Egyptian" },
  }),
  listDelegationCandidates: vi
    .fn()
    .mockResolvedValue({ status: "success", data: [] }),
}));

import RequestLeavePage, { LeaveSubmissionError } from "./RequestLeavePage";
import {
  getEmployee,
  listDelegationCandidates,
} from "../../../services/api/employeesApi";
import {
  getLeavePageLoadErrorMessage,
  getLeaveValidationErrors,
  isEmployeeLeaveDateDisabled,
} from "./leaveRequestValidation";
import { useI18nStore } from "../../../i18n/i18nStore";

const today = dayjs("2026-08-11");

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  vi.mocked(listDelegationCandidates).mockClear();
  vi.mocked(getEmployee).mockResolvedValue({
    status: "success",
    data: { id: 1, is_saudi: false, nationality: "Egyptian" },
  } as never);
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

  it("loads global delegation candidates for the selector", async () => {
    render(
      <MemoryRouter>
        <RequestLeavePage />
      </MemoryRouter>,
    );

    await screen.findByText(
      "Leave can be submitted up to 7 calendar days after it starts.",
    );

    expect(listDelegationCandidates).toHaveBeenCalledWith();
  });

  it("asks non-Saudi travellers whether a visa is required", async () => {
    render(
      <MemoryRouter>
        <RequestLeavePage />
      </MemoryRouter>,
    );

    const travel = await screen.findByText("Will you travel?");
    const travelItem = travel.closest(".ant-form-item") as HTMLElement;
    fireEvent.click(within(travelItem).getByText("Yes"));
    expect(
      await screen.findByText("Will you require a visa?"),
    ).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /Submit Request/ });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    expect(
      await screen.findAllByText("Required when you travel."),
    ).toHaveLength(7);

    fireEvent.click(within(travelItem).getByText("No"));
    await waitFor(() =>
      expect(
        screen.queryByText("Will you require a visa?"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryAllByText("Required when you travel.")).toHaveLength(
        0,
      ),
    );
  });

  it("never asks Saudi employees for a visa answer", async () => {
    vi.mocked(getEmployee).mockResolvedValue({
      status: "success",
      data: { id: 1, is_saudi: true, nationality: "Saudi Arabia" },
    } as never);
    render(
      <MemoryRouter>
        <RequestLeavePage />
      </MemoryRouter>,
    );

    const travel = await screen.findByText("Will you travel?");
    fireEvent.click(
      within(travel.closest(".ant-form-item") as HTMLElement).getByText("Yes"),
    );
    expect(
      screen.queryByText("Will you require a visa?"),
    ).not.toBeInTheDocument();
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

  it("keeps the server's actionable profile error instead of replacing it with a generic retry message", () => {
    expect(
      getLeavePageLoadErrorMessage({
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            status: "error",
            message:
              "No employee profile is linked to your account in the selected company.",
          },
        },
      }),
    ).toBe(
      "No employee profile is linked to your account in the selected company.",
    );
  });
});
