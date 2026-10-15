import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { notification } from "antd";

vi.mock(
  "../../../services/api/cancellationRequestsApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../services/api/cancellationRequestsApi")
    >()),
    listCancellationRequests: vi.fn(),
    confirmCancellationRequest: vi.fn(),
    declineCancellationRequest: vi.fn(),
  }),
);

import CancellationRequestsPage from "./CancellationRequestsPage";
import {
  confirmCancellationRequest,
  declineCancellationRequest,
  listCancellationRequests,
  type CancellationRequestItem,
} from "../../../services/api/cancellationRequestsApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const item = (
  overrides: Partial<CancellationRequestItem> = {},
): CancellationRequestItem => ({
  id: 11,
  kind: "leave",
  request_id: 5,
  reference_no: "LV-005",
  employee_name: "Ali Hassan",
  request_title: "Annual leave 1-5 Nov",
  request_status: "approved",
  reason: "Trip cancelled",
  status: "pending",
  requested_at: "2026-10-01T08:00:00Z",
  decided_at: null,
  decided_by_name: null,
  decision_note: "",
  detail_path: "/hr/leave/requests/5",
  can_decide: true,
  ...overrides,
});

const listResponse = (items: CancellationRequestItem[]) =>
  ({
    status: "success",
    data: {
      items,
      page: 1,
      page_size: 20,
      count: items.length,
      total_pages: 1,
    },
  }) as never;

function renderPage() {
  return render(
    <MemoryRouter>
      <CancellationRequestsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(notification, "success").mockImplementation(() => {});
  vi.spyOn(notification, "error").mockImplementation(() => {});
  vi.mocked(listCancellationRequests).mockResolvedValue(listResponse([item()]));
  return useI18nStore.getState().setLanguage("en");
});

describe("CancellationRequestsPage", () => {
  it("loads pending requests and links to the target request", async () => {
    renderPage();
    expect(await screen.findByText("Ali Hassan")).toBeInTheDocument();
    expect(listCancellationRequests).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", page: 1 }),
    );
    expect(screen.getByRole("link", { name: /LV-005/ })).toHaveAttribute(
      "href",
      "/hr/leave/requests/5",
    );
  });

  it("refetches when the status tab changes", async () => {
    renderPage();
    await screen.findByText("Ali Hassan");
    fireEvent.click(screen.getByText("Declined"));
    await waitFor(() =>
      expect(listCancellationRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "declined" }),
      ),
    );
  });

  it("confirms with an optional comment", async () => {
    vi.mocked(confirmCancellationRequest).mockResolvedValue({
      status: "success",
      data: item({ status: "confirmed" }),
    } as never);
    renderPage();
    await screen.findByText("Ali Hassan");
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: Ali Hassan" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(confirmCancellationRequest).toHaveBeenCalledWith(11, undefined),
    );
    await waitFor(() =>
      expect(listCancellationRequests).toHaveBeenCalledTimes(2),
    );
  });

  it("requires a comment to decline", async () => {
    vi.mocked(declineCancellationRequest).mockResolvedValue({
      status: "success",
      data: item({ status: "declined" }),
    } as never);
    renderPage();
    await screen.findByText("Ali Hassan");
    fireEvent.click(
      screen.getByRole("button", { name: "Decline: Ali Hassan" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline" }));
    expect(
      await within(dialog).findByText("A comment is required to decline."),
    ).toBeInTheDocument();
    expect(declineCancellationRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Already booked" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(declineCancellationRequest).toHaveBeenCalledWith(
        11,
        "Already booked",
      ),
    );
  });

  it("hides actions for the HR member own request", async () => {
    vi.mocked(listCancellationRequests).mockResolvedValue(
      listResponse([item({ can_decide: false })]),
    );
    renderPage();
    await screen.findByText("Ali Hassan");
    expect(
      screen.queryByRole("button", { name: /^Confirm/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Your own request must be decided by someone else."),
    ).toBeInTheDocument();
  });

  it("refreshes the list when the request is no longer pending", async () => {
    vi.mocked(confirmCancellationRequest).mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation error",
          errors: ["This cancellation request is no longer pending."],
        },
      },
    });
    renderPage();
    await screen.findByText("Ali Hassan");
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: Ali Hassan" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(listCancellationRequests).toHaveBeenCalledTimes(2),
    );
    expect(notification.error).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "This cancellation request is no longer pending.",
      }),
    );
  });
});
