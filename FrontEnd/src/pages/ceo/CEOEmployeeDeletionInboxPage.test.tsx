import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../services/api/employeesApi", () => ({
  listEmployeeArchiveRequests: vi.fn(),
}));

import CEOEmployeeDeletionInboxPage from "./CEOEmployeeDeletionInboxPage";
import * as employeesApi from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const listEmployeeArchiveRequests = employeesApi.listEmployeeArchiveRequests as unknown as ReturnType<
  typeof vi.fn
>;

const row = {
  id: 5,
  status: "PENDING_CEO" as const,
  company_name: "FFI",
  requested_by_name: "HR Manager",
  reason: "Contract ended",
  archive_reason: "RESIGNATION",
  created_at: "2026-08-01T09:00:00Z",
  request_snapshot: {
    full_name_en: "Sara Ahmed",
    full_name_ar: "سارة أحمد",
    email: "sara@ffi.test",
    department_name: "Finance",
  },
};

const ok = (items: unknown[]) => ({ status: "success" as const, data: { items, count: items.length } });

beforeEach(() => {
  navigateMock.mockClear();
  listEmployeeArchiveRequests.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEOEmployeeDeletionInboxPage", () => {
  it("defaults to the pending queue and shows its outstanding count", async () => {
    listEmployeeArchiveRequests.mockResolvedValue(ok([row]));

    render(<CEOEmployeeDeletionInboxPage />);

    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(listEmployeeArchiveRequests).toHaveBeenCalledWith({
      status: "PENDING_CEO",
      page: 1,
      page_size: 20,
    });
    expect(screen.getByText("1 awaiting")).toBeInTheDocument();
  });

  it("keeps the status filter reachable while the queue is empty", async () => {
    listEmployeeArchiveRequests.mockResolvedValue(ok([]));

    render(<CEOEmployeeDeletionInboxPage />);

    expect(await screen.findByText("No archive requests in this status.")).toBeInTheDocument();

    listEmployeeArchiveRequests.mockResolvedValue(ok([{ ...row, status: "EXECUTED" }]));
    fireEvent.click(screen.getByText("Archived"));

    await waitFor(() =>
      expect(listEmployeeArchiveRequests).toHaveBeenLastCalledWith({
        status: "EXECUTED",
        page: 1,
        page_size: 20,
      }),
    );
  });

  it("shows a retryable error state when the queue fails", async () => {
    listEmployeeArchiveRequests.mockResolvedValue({ status: "error" as const, message: "server error" });

    render(<CEOEmployeeDeletionInboxPage />);

    expect(await screen.findByText("server error")).toBeInTheDocument();

    listEmployeeArchiveRequests.mockResolvedValue(ok([row]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
  });

  it("opens the request from a clearly named review action", async () => {
    listEmployeeArchiveRequests.mockResolvedValue(ok([row]));

    render(<CEOEmployeeDeletionInboxPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Review: Sara Ahmed" }));
    expect(navigateMock).toHaveBeenCalledWith("/ceo/employees/deletion-requests/5");
  });

  it("uses the Arabic name and status wording in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    listEmployeeArchiveRequests.mockResolvedValue(ok([row]));

    render(<CEOEmployeeDeletionInboxPage />);

    expect(await screen.findByText("سارة أحمد")).toBeInTheDocument();
  });
});
