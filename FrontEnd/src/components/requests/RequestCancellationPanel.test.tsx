import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { notification } from "antd";

vi.mock(
  "../../services/api/cancellationRequestsApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../services/api/cancellationRequestsApi")
    >()),
    requestCancellation: vi.fn(),
    withdrawCancellationRequest: vi.fn(),
  }),
);

import RequestCancellationPanel from "./RequestCancellationPanel";
import {
  requestCancellation,
  withdrawCancellationRequest,
} from "../../services/api/cancellationRequestsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import type { WorkflowSnapshot } from "../../types/workflow";

const cancellationRequest = (
  overrides: Partial<NonNullable<WorkflowSnapshot["cancellation_request"]>>,
) => ({
  id: 1,
  status: "pending" as const,
  reason: "Trip cancelled",
  requested_at: "2026-10-01T08:00:00Z",
  decided_at: null,
  decided_by_name: null,
  decision_note: "",
  ...overrides,
});

const workflow = (extra: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot => ({
  status: "approved",
  history: [],
  ...extra,
});

const canRequest = () => workflow({ can_request_cancellation: true });

async function openAndFill(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value } });
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(notification, "success").mockImplementation(() => {});
  vi.spyOn(notification, "error").mockImplementation(() => {});
  return useI18nStore.getState().setLanguage("en");
});

describe("RequestCancellationPanel", () => {
  it.each([
    ["absent", workflow()],
    ["false", workflow({ can_request_cancellation: false })],
  ])("hides the request button when the flag is %s", (_label, flow) => {
    const { container } = render(
      <RequestCancellationPanel
        kind="leave"
        request={{ id: 1, workflow: flow }}
        onChanged={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks empty and short reasons", async () => {
    render(
      <RequestCancellationPanel
        kind="leave"
        request={{ id: 1, workflow: canRequest() }}
        onChanged={vi.fn()}
      />,
    );
    const dialog = await openAndFill("");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    expect(
      await within(dialog).findByText("Please enter a reason."),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "abc" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    expect(
      await within(dialog).findByText(
        "The reason must be at least 5 characters.",
      ),
    ).toBeInTheDocument();
    expect(requestCancellation).not.toHaveBeenCalled();
  });

  it.each([
    "leave",
    "permission",
    "annual_leave_payment",
    "asset_return",
    "asset_damage",
    "loan",
  ] as const)("sends the trimmed reason for %s once", async (kind) => {
    let finish!: (value: unknown) => void;
    vi.mocked(requestCancellation).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const onChanged = vi.fn();
    render(
      <RequestCancellationPanel
        kind={kind}
        request={{ id: 7, workflow: canRequest() }}
        onChanged={onChanged}
      />,
    );
    const dialog = await openAndFill("  Plans changed  ");
    const send = within(dialog).getByRole("button", { name: "Send request" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(requestCancellation).toHaveBeenCalledTimes(1);
    expect(requestCancellation).toHaveBeenCalledWith(kind, 7, "Plans changed");
    finish({ status: "success", data: { id: 7 } });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("maps a reason field error onto the textarea", async () => {
    vi.mocked(requestCancellation).mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation error",
          errors: [{ field: "reason", message: "Reason is too vague." }],
        },
      },
    });
    const onChanged = vi.fn();
    render(
      <RequestCancellationPanel
        kind="leave"
        request={{ id: 1, workflow: canRequest() }}
        onChanged={onChanged}
      />,
    );
    const dialog = await openAndFill("valid reason");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    expect(
      await within(dialog).findByText("Reason is too vague."),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows the not-eligible message and refreshes", async () => {
    vi.mocked(requestCancellation).mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation error",
          errors: ["A cancellation request is already pending."],
        },
      },
    });
    const onChanged = vi.fn();
    render(
      <RequestCancellationPanel
        kind="loan"
        request={{ id: 1, workflow: canRequest() }}
        onChanged={onChanged}
      />,
    );
    const dialog = await openAndFill("valid reason");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(notification.error).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "A cancellation request is already pending.",
      }),
    );
  });

  it("shows the pending state and withdraws only when the flag is true", async () => {
    vi.mocked(withdrawCancellationRequest).mockResolvedValue({
      status: "success",
      data: { id: 3 },
    } as never);
    const onChanged = vi.fn();
    const { rerender } = render(
      <RequestCancellationPanel
        kind="asset_return"
        request={{
          id: 3,
          workflow: workflow({
            can_withdraw_cancellation_request: true,
            cancellation_request: cancellationRequest({}),
          }),
        }}
        onChanged={onChanged}
      />,
    );
    expect(
      screen.getByText("Cancellation requested, waiting for HR"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Trip cancelled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Withdraw request" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(withdrawCancellationRequest).toHaveBeenCalledWith("asset_return", 3);

    rerender(
      <RequestCancellationPanel
        kind="asset_return"
        request={{
          id: 3,
          workflow: workflow({
            can_withdraw_cancellation_request: false,
            cancellation_request: cancellationRequest({}),
          }),
        }}
        onChanged={onChanged}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Withdraw request" }),
    ).not.toBeInTheDocument();
  });

  it("renders the confirmed and declined outcomes with the HR note", () => {
    const { rerender } = render(
      <RequestCancellationPanel
        kind="leave"
        request={{
          id: 1,
          workflow: workflow({
            cancellation_request: cancellationRequest({
              status: "declined",
              decided_at: "2026-10-02T08:00:00Z",
              decided_by_name: "Sara HR",
              decision_note: "Already booked",
            }),
          }),
        }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Cancellation declined by HR")).toBeInTheDocument();
    expect(screen.getByText(/Already booked/)).toBeInTheDocument();
    rerender(
      <RequestCancellationPanel
        kind="leave"
        request={{
          id: 1,
          workflow: workflow({
            cancellation_request: cancellationRequest({
              status: "confirmed",
              decided_at: "2026-10-02T08:00:00Z",
              decided_by_name: "Sara HR",
            }),
          }),
        }}
        onChanged={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Cancellation confirmed by HR"),
    ).toBeInTheDocument();
  });
});
