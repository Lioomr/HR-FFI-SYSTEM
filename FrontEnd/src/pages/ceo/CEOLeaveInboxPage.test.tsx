import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../services/api/leaveApi", () => ({
  getCEOLeaveRequests: vi.fn(),
  approveCEOLeaveRequest: vi.fn(),
  rejectCEOLeaveRequest: vi.fn(),
  getLeaveRequestDocumentBlob: vi.fn(),
}));

vi.mock("../../components/leaves/LeaveApprovalMap", () => ({
  default: () => <div data-testid="leave-approval-map" />,
}));

vi.mock("../../components/requests/RequestObligationsPanel", () => ({
  default: () => <div data-testid="obligations-panel" />,
}));

import CEOLeaveInboxPage from "./CEOLeaveInboxPage";
import * as leaveApi from "../../services/api/leaveApi";
import type { LeaveRequest } from "../../services/api/leaveApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getCEOLeaveRequests = leaveApi.getCEOLeaveRequests as unknown as ReturnType<typeof vi.fn>;
const approveCEOLeaveRequest = leaveApi.approveCEOLeaveRequest as unknown as ReturnType<typeof vi.fn>;
const rejectCEOLeaveRequest = leaveApi.rejectCEOLeaveRequest as unknown as ReturnType<typeof vi.fn>;

function makeRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 41,
    employee: { id: 7, full_name: "Sara Ahmed" },
    leave_type: { id: 1, name: "Annual" },
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    days: 5,
    status: "pending_ceo",
    ...overrides,
  } as LeaveRequest;
}

const listResponse = (items: LeaveRequest[]) => ({
  status: "success" as const,
  data: { items, count: items.length, page: 1, page_size: 20 },
});

beforeEach(() => {
  getCEOLeaveRequests.mockReset();
  approveCEOLeaveRequest.mockReset();
  rejectCEOLeaveRequest.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEOLeaveInboxPage", () => {
  it("shows the outstanding count beside the title", async () => {
    getCEOLeaveRequests.mockResolvedValue(listResponse([makeRequest()]));

    render(<CEOLeaveInboxPage />);

    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(screen.getByText("1 awaiting")).toBeInTheDocument();
  });

  it("labels both decision buttons in text, not by colour alone", async () => {
    getCEOLeaveRequests.mockResolvedValue(listResponse([makeRequest()]));

    render(<CEOLeaveInboxPage />);

    expect(await screen.findByRole("button", { name: "Approve: Sara Ahmed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject: Sara Ahmed" })).toBeInTheDocument();
  });

  it("renders an empty state when nothing is awaiting the CEO", async () => {
    getCEOLeaveRequests.mockResolvedValue(listResponse([]));

    render(<CEOLeaveInboxPage />);

    expect(await screen.findByText("No pending leave requests found.")).toBeInTheDocument();
    expect(screen.getByText("New requests appear here as soon as they reach you.")).toBeInTheDocument();
  });

  it("renders a retryable error state when the queue fails to load", async () => {
    getCEOLeaveRequests.mockResolvedValue({ status: "error" as const, message: "backend down" });

    render(<CEOLeaveInboxPage />);

    expect(await screen.findByText("backend down")).toBeInTheDocument();

    getCEOLeaveRequests.mockResolvedValue(listResponse([makeRequest()]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
  });

  it("approves without a waiver when nothing is blocking", async () => {
    getCEOLeaveRequests.mockResolvedValue(listResponse([makeRequest()]));
    approveCEOLeaveRequest.mockResolvedValue({ status: "success" as const, data: makeRequest() });

    render(<CEOLeaveInboxPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve: Sara Ahmed" }));
    expect(await screen.findByText("Approve Leave Request")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveCEOLeaveRequest).toHaveBeenCalledWith(41, undefined, undefined));
  });

  it("requires a CEO waiver reason when blocking obligations remain", async () => {
    getCEOLeaveRequests.mockResolvedValue(
      listResponse([makeRequest({ obligations_summary: { blocking_open: 2 } } as Partial<LeaveRequest>)]),
    );
    approveCEOLeaveRequest.mockResolvedValue({ status: "success" as const, data: makeRequest() });

    render(<CEOLeaveInboxPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve: Sara Ahmed" }));
    expect(await screen.findByText(/2 blocking obligation/)).toBeInTheDocument();

    // Submitting with an empty waiver is blocked at the field, not sent.
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Waiver reason is required.")).toBeInTheDocument();
    expect(approveCEOLeaveRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Waiver reason"), { target: { value: "Board approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(approveCEOLeaveRequest).toHaveBeenCalledWith(41, undefined, "Board approved"),
    );
  });

  it("requires a written reason before a rejection is sent", async () => {
    getCEOLeaveRequests.mockResolvedValue(listResponse([makeRequest()]));
    rejectCEOLeaveRequest.mockResolvedValue({ status: "success" as const, data: makeRequest() });

    render(<CEOLeaveInboxPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Reject: Sara Ahmed" }));
    expect(await screen.findByText("Reject Leave Request")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reject Request" }));
    expect(await screen.findByText("A rejection reason is required.")).toBeInTheDocument();
    expect(rejectCEOLeaveRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Coverage gap" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject Request" }));

    await waitFor(() => expect(rejectCEOLeaveRequest).toHaveBeenCalledWith(41, "Coverage gap"));
  });

  it("renders Arabic labels when the language is Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getCEOLeaveRequests.mockResolvedValue(listResponse([makeRequest()]));

    render(<CEOLeaveInboxPage />);

    expect(await screen.findByRole("button", { name: "موافقة: Sara Ahmed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "رفض: Sara Ahmed" })).toBeInTheDocument();
  });
});
