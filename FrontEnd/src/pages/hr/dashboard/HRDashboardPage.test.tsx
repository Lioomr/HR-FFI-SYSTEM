import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../services/api/hrSummaryApi", () => ({
  getHrSummary: vi.fn(),
}));

vi.mock("../../../services/api/pendingRequestsApi", () => ({
  getPendingRequests: vi.fn(),
}));

vi.mock("../../../components/announcements/AnnouncementWidget", () => ({
  default: () => <div data-testid="announcement-widget" />,
}));

import HRDashboardPage from "./HRDashboardPage";
import * as hrSummaryApi from "../../../services/api/hrSummaryApi";
import type { HRSummary } from "../../../services/api/hrSummaryApi";
import * as pendingApi from "../../../services/api/pendingRequestsApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const getHrSummary = hrSummaryApi.getHrSummary as unknown as ReturnType<typeof vi.fn>;
const getPendingRequests = pendingApi.getPendingRequests as unknown as ReturnType<typeof vi.fn>;

function makeSummary(overrides: Partial<HRSummary> = {}): HRSummary {
  return {
    total_employees: 142,
    active_employees: 130,
    expiring_docs: 4,
    pending_leaves: 3,
    pending_approvals: [],
    recent_activity: [],
    latest_payroll: { latest_total_net: 250000, latest_period: "7/2026", trend_percentage: 4.2 },
    ...overrides,
  };
}

const summaryResponse = (summary: HRSummary) => ({ status: "success" as const, data: summary });
const pendingResponse = (count: number) => ({
  status: "success" as const,
  data: { items: [], page: 1, page_size: 1, count, total_pages: 1 },
});

beforeEach(() => {
  navigateMock.mockClear();
  getHrSummary.mockReset();
  getPendingRequests.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("HRDashboardPage", () => {
  it("renders the KPI figures returned by the API", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(7));

    render(<HRDashboardPage />);

    expect(await screen.findByText("142")).toBeInTheDocument();
    expect(screen.getByText("130 currently active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pending Requests: 7/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave Awaiting HR: 3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expiring Docs: 4/ })).toBeInTheDocument();
  });

  it("flags expiring documents with text, not colour alone", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary({ expiring_docs: 9 })));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("Action needed")).toBeInTheDocument();
  });

  it("omits the expiry warning when nothing is expiring", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary({ expiring_docs: 0 })));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    await screen.findByText("142");
    expect(screen.queryByText("Action needed")).not.toBeInTheDocument();
  });

  it("shows empty states for approvals, activity and payroll", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          latest_payroll: { latest_total_net: null, latest_period: null, trend_percentage: null },
        })
      )
    );
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("No pending approvals")).toBeInTheDocument();
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
    expect(screen.getByText("No payroll run yet")).toBeInTheDocument();
  });

  it("states that a payroll run has no comparison baseline", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          latest_payroll: { latest_total_net: 120000, latest_period: "1/2026", trend_percentage: null },
        })
      )
    );
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("No previous run to compare")).toBeInTheDocument();
    expect(screen.getByText(/January 2026/)).toBeInTheDocument();
  });

  it("lists pending approvals with a review action", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          pending_approvals: [
            {
              id: 12,
              workflow_id: 3,
              name: "Sara Ahmed",
              request_type: "LEAVE",
              request_type_label: "Leave",
              action: "Leave: Annual",
              time: "2026-07-30T09:00:00Z",
              avatar: "",
              review_path: "/hr/leave/requests/12",
              current_approver_role: "HRManager",
            },
          ],
        })
      )
    );
    getPendingRequests.mockResolvedValue(pendingResponse(1));

    render(<HRDashboardPage />);

    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review: Sara Ahmed/ }));
    expect(navigateMock).toHaveBeenCalledWith("/hr/leave/requests/12");
  });

  it("says how many pending items are hidden from the preview", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          pending_approvals: [
            {
              id: 1,
              workflow_id: 1,
              name: "A",
              request_type: "LOAN",
              request_type_label: "Loan",
              action: "Loan: 5000",
              time: "2026-07-30T09:00:00Z",
              avatar: "",
              review_path: "/hr/loan-requests/1",
              current_approver_role: "HRManager",
            },
          ],
        })
      )
    );
    getPendingRequests.mockResolvedValue(pendingResponse(6));

    render(<HRDashboardPage />);

    expect(await screen.findByText("Showing 1 of 6")).toBeInTheDocument();
  });

  it("exposes KPI tiles as keyboard-reachable buttons that navigate", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    const tile = await screen.findByRole("button", { name: /Total Employees: 142/ });
    fireEvent.click(tile);
    expect(navigateMock).toHaveBeenCalledWith("/hr/employees");
  });

  it("refetches without tearing down the page when refreshed", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);
    await screen.findByText("142");

    getHrSummary.mockResolvedValue(summaryResponse(makeSummary({ total_employees: 143 })));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText("143")).toBeInTheDocument());
    expect(getHrSummary).toHaveBeenCalledTimes(2);
  });

  it("renders a retryable error state when the summary fails", async () => {
    getHrSummary.mockRejectedValue(new Error("network down"));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("network down")).toBeInTheDocument();
  });
});
