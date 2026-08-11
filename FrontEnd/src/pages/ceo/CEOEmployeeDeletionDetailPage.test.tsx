import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "5" }),
}));

vi.mock("../../services/api/employeesApi", () => ({
  getEmployeeArchiveRequest: vi.fn(),
  approveEmployeeArchiveRequest: vi.fn(),
  rejectEmployeeArchiveRequest: vi.fn(),
}));

import CEOEmployeeDeletionDetailPage from "./CEOEmployeeDeletionDetailPage";
import * as employeesApi from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getRequest = employeesApi.getEmployeeArchiveRequest as unknown as ReturnType<typeof vi.fn>;
const approveRequest = employeesApi.approveEmployeeArchiveRequest as unknown as ReturnType<typeof vi.fn>;
const rejectRequest = employeesApi.rejectEmployeeArchiveRequest as unknown as ReturnType<typeof vi.fn>;

const request = {
  id: 5,
  status: "PENDING_CEO" as const,
  company_name: "FFI",
  requested_by_name: "HR Manager",
  reason: "Contract ended",
  archive_reason: "RESIGNATION",
  created_at: "2026-08-01T09:00:00Z",
  request_snapshot: {
    full_name_en: "Sara Ahmed",
    employee_id: "FFI-001",
    email: "sara@ffi.test",
    department_name: "Finance",
  },
  execution_snapshot: {},
};

const ok = (data: unknown) => ({ status: "success" as const, data });

beforeEach(() => {
  navigateMock.mockClear();
  [getRequest, approveRequest, rejectRequest].forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEOEmployeeDeletionDetailPage", () => {
  it("puts the decision above the record detail", async () => {
    getRequest.mockResolvedValue(ok(request));

    render(<CEOEmployeeDeletionDetailPage />);

    expect(await screen.findByRole("button", { name: "Approve & Archive: Sara Ahmed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject: Sara Ahmed" })).toBeInTheDocument();
    expect(screen.getByText("Contract ended")).toBeInTheDocument();
  });

  it("confirms an approval before sending it", async () => {
    getRequest.mockResolvedValue(ok(request));
    approveRequest.mockResolvedValue(ok({ ...request, status: "EXECUTED" }));

    render(<CEOEmployeeDeletionDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve & Archive: Sara Ahmed" }));
    expect(await screen.findByText(/about to archive Sara Ahmed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve & Archive" }));

    await waitFor(() => expect(approveRequest).toHaveBeenCalledWith(5));
  });

  it("requires a reason before rejecting and surfaces a server failure inline", async () => {
    getRequest.mockResolvedValue(ok(request));
    rejectRequest.mockResolvedValue({ status: "error" as const, message: "rejection refused" });

    render(<CEOEmployeeDeletionDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Reject: Sara Ahmed" }));

    fireEvent.click(screen.getByRole("button", { name: "Submit Rejection" }));
    expect(await screen.findByText("A rejection reason is required.")).toBeInTheDocument();
    expect(rejectRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), {
      target: { value: "Still holds assets" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Rejection" }));

    await waitFor(() => expect(rejectRequest).toHaveBeenCalledWith(5, "Still holds assets"));
    expect(await screen.findByText("rejection refused")).toBeInTheDocument();
  });

  it("hides the decision panel once the request is settled", async () => {
    getRequest.mockResolvedValue(ok({ ...request, status: "EXECUTED", executed_at: "2026-08-02T09:00:00Z" }));

    render(<CEOEmployeeDeletionDetailPage />);

    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve & Archive/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reject/ })).not.toBeInTheDocument();
  });

  it("shows a retryable error state when the request cannot be loaded", async () => {
    getRequest.mockResolvedValue({ status: "error" as const, message: "not reachable" });

    render(<CEOEmployeeDeletionDetailPage />);

    expect(await screen.findByText("not reachable")).toBeInTheDocument();

    getRequest.mockResolvedValue(ok(request));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Contract ended")).toBeInTheDocument());
  });
});
