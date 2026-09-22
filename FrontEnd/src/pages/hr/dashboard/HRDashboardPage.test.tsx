import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

const getHrSummary = hrSummaryApi.getHrSummary as unknown as ReturnType<
  typeof vi.fn
>;
const getPendingRequests =
  pendingApi.getPendingRequests as unknown as ReturnType<typeof vi.fn>;

function makeSummary(overrides: Partial<HRSummary> = {}): HRSummary {
  return {
    total_employees: 142,
    active_employees: 130,
    expiring_docs: 4,
    expiring_documents: {
      window_days: 30,
      employee_count: 4,
      by_type: {
        national_id: 1,
        iqama: 2,
        passport: 1,
        work_license: 3,
        contract: 1,
        health_insurance: 1,
      },
      soonest: [
        {
          employee_id: 7,
          full_name: "Omar Khan",
          doc_type: "iqama",
          expiry_date: "2026-09-21",
          days_left: 0,
        },
        {
          employee_id: 8,
          full_name: "Lina Saad",
          doc_type: "health_insurance",
          expiry_date: "2026-10-11",
          days_left: 20,
        },
      ],
    },
    pending_leaves: 3,
    recent_activity: [],
    workforce_status: {
      currently_employed: 120,
      on_leave_outside: 6,
      on_leave_inside: 4,
      archived: 12,
    },
    nationality_breakdown: {
      saudi_active: 39,
      active_total: 130,
      nationalities: [
        { nationality: "Egypt", total: 70, active: 66, is_saudi: false },
        { nationality: "Saudi Arabia", total: 40, active: 39, is_saudi: true },
        { nationality: "Bengali", total: 10, active: 10, is_saudi: false },
        { nationality: "Bangladesh", total: 5, active: 5, is_saudi: false },
        { nationality: null, total: 5, active: 5, is_saudi: false },
      ],
    },
    latest_payroll: {
      latest_total_net: 250000,
      latest_period: "7/2026",
      trend_percentage: 4.2,
    },
    ...overrides,
  };
}

const summaryResponse = (summary: HRSummary) => ({
  status: "success" as const,
  data: summary,
});
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

    expect(
      await screen.findByRole("button", { name: /Total Employees: 142/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("130 active · 12 inactive")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Pending Requests: 7/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Leave Awaiting HR/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Expiring Docs/ }),
    ).not.toBeInTheDocument();
  });

  it("breaks expiring documents down by type and opens the expiries page", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(
      await screen.findByText("4 employees · next 30 days"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "National ID: 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Passport: 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Work license: 3" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Contract: 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Health insurance: 1" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Iqama: 2" }));
    expect(navigateMock).toHaveBeenCalledWith("/hr/employees/expiries");
  });

  it("lists the documents expiring soonest with days left in text", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("Omar Khan")).toBeInTheDocument();
    expect(screen.getByText("Expires today")).toBeInTheDocument();
    expect(
      screen.getByText("Health insurance · 2026-10-11"),
    ).toBeInTheDocument();
    expect(screen.getByText("20 days left")).toBeInTheDocument();
  });

  it("shows empty states for expiring documents, activity and payroll", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          expiring_documents: {
            window_days: 30,
            employee_count: 0,
            by_type: {
              national_id: 0,
              iqama: 0,
              passport: 0,
              work_license: 0,
              contract: 0,
              health_insurance: 0,
            },
            soonest: [],
          },
          latest_payroll: {
            latest_total_net: null,
            latest_period: null,
            trend_percentage: null,
          },
        }),
      ),
    );
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(
      await screen.findByText("No documents expire in the next 30 days"),
    ).toBeInTheDocument();
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
    expect(screen.getByText("No payroll run yet")).toBeInTheDocument();
  });

  it("states that a payroll run has no comparison baseline", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          latest_payroll: {
            latest_total_net: 120000,
            latest_period: "1/2026",
            trend_percentage: null,
          },
        }),
      ),
    );
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(
      await screen.findByText("No previous run to compare"),
    ).toBeInTheDocument();
    expect(screen.getByText(/January 2026/)).toBeInTheDocument();
  });

  it("exposes KPI tiles as keyboard-reachable buttons that navigate", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    const tile = await screen.findByRole("button", {
      name: /Total Employees: 142/,
    });
    fireEvent.click(tile);
    expect(navigateMock).toHaveBeenCalledWith("/hr/employees");
  });

  it("charts where the workforce is today", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    const donut = await screen.findByRole("img", {
      name: "Currently employed 120 (85%), On leave – outside the country 6 (4%), On leave – inside the country 4 (3%), Archived 12 (8%)",
    });
    expect(donut).toBeInTheDocument();
    expect(screen.getByText("Workforce status")).toBeInTheDocument();
  });

  it("lists every nationality with the Saudization rate", async () => {
    getHrSummary.mockResolvedValue(summaryResponse(makeSummary()));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("30%")).toBeInTheDocument();
    expect(screen.getByLabelText("Egypt: 70 (54%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Saudi Arabia: 40 (31%)")).toBeInTheDocument();
    // "Bengali" and "Bangladesh" are the same country and merge into one bar.
    expect(screen.getByLabelText("Bangladesh: 15 (12%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Not specified: 5 (4%)")).toBeInTheDocument();
  });

  it("folds nationalities beyond the eighth into one row", async () => {
    const names = [
      "Egypt",
      "India",
      "Pakistan",
      "Sudan",
      "Lebanon",
      "Jordan",
      "Syria",
      "Yemen",
      "Kenya",
      "Nepal",
    ];
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          nationality_breakdown: {
            saudi_active: 0,
            active_total: 55,
            nationalities: names.map((nationality, index) => ({
              nationality,
              total: 10 - index,
              active: 10 - index,
              is_saudi: false,
            })),
          },
        }),
      ),
    );
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(
      await screen.findByLabelText("Other nationalities (3): 6 (11%)"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Nepal/)).not.toBeInTheDocument();
  });

  it("shows empty chart states when there are no employees", async () => {
    getHrSummary.mockResolvedValue(
      summaryResponse(
        makeSummary({
          total_employees: 0,
          active_employees: 0,
          workforce_status: {
            currently_employed: 0,
            on_leave_outside: 0,
            on_leave_inside: 0,
            archived: 0,
          },
          nationality_breakdown: {
            saudi_active: 0,
            active_total: 0,
            nationalities: [],
          },
        }),
      ),
    );
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findAllByText("No employees yet")).toHaveLength(2);
  });

  it("renders a retryable error state when the summary fails", async () => {
    getHrSummary.mockRejectedValue(new Error("network down"));
    getPendingRequests.mockResolvedValue(pendingResponse(0));

    render(<HRDashboardPage />);

    expect(await screen.findByText("network down")).toBeInTheDocument();
  });
});
