vi.mock("../../components/executive/ExecutiveNotifications", () => ({
  default: () => <div />,
}));
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../services/api/ceoSummaryApi", () => ({
  getCeoApprovalSummary: vi.fn(),
  getCfoApprovalSummary: vi.fn(),
  CEO_QUEUE_KEYS: [
    "leave",
    "loan",
    "attendance",
    "assetDamage",
    "assetReturn",
    "employeeArchive",
    "jobOffers",
    "contracts",
    "annualLeave",
  ],
}));

vi.mock("../../components/announcements/AnnouncementWidget", () => ({
  default: () => <div data-testid="announcement-widget" />,
}));

import CFODashboardPage from "../cfo/CFODashboardPage";
import CEODashboardPage from "./CEODashboardPage";
import * as ceoSummaryApi from "../../services/api/ceoSummaryApi";
import type {
  CeoApprovalSummary,
  CeoQueueKey,
} from "../../services/api/ceoSummaryApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getCeoApprovalSummary =
  ceoSummaryApi.getCeoApprovalSummary as unknown as ReturnType<typeof vi.fn>;

const QUEUE_KEYS: CeoQueueKey[] = [
  "leave",
  "loan",
  "attendance",
  "assetDamage",
  "assetReturn",
  "employeeArchive",
  "jobOffers",
  "contracts",
  "annualLeave",
];

function makeSummary(
  counts: Partial<Record<CeoQueueKey, number>> = {},
  unavailable: CeoQueueKey[] = [],
): CeoApprovalSummary {
  const queues = {} as CeoApprovalSummary["queues"];
  let totalPending = 0;
  QUEUE_KEYS.forEach((key) => {
    const available = !unavailable.includes(key);
    const count = available ? (counts[key] ?? 0) : 0;
    queues[key] = { key, count, available };
    if (available) totalPending += count;
  });
  return {
    queues,
    totalPending,
    allUnavailable: unavailable.length === QUEUE_KEYS.length,
  };
}

beforeEach(() => {
  navigateMock.mockClear();
  getCeoApprovalSummary.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEODashboardPage", () => {
  it("summarises every approval queue with its pending count", async () => {
    getCeoApprovalSummary.mockResolvedValue(
      makeSummary({
        leave: 3,
        loan: 2,
        attendance: 1,
        assetDamage: 4,
        assetReturn: 1,
        employeeArchive: 5,
      }),
    );

    render(<CEODashboardPage />);

    // 3 + 2 + 1 + 4 + 1 + 5
    expect(
      await screen.findByRole("button", { name: /Awaiting Your Decision: 16/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Leave Requests: 3/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Loan Requests: 2/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Attendance: 1/ }),
    ).toBeInTheDocument();
  });

  it("shows an all-clear message when nothing is pending", async () => {
    getCeoApprovalSummary.mockResolvedValue(makeSummary());

    render(<CEODashboardPage />);

    expect(
      await screen.findByText("Nothing is waiting on you right now"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("None pending")).toHaveLength(9);
  });

  it("orders approval areas by backlog size so the biggest queue is first", async () => {
    getCeoApprovalSummary.mockResolvedValue(
      makeSummary({ leave: 1, employeeArchive: 9, loan: 4 }),
    );

    render(<CEODashboardPage />);

    await screen.findByText("9 awaiting review");
    const reviewButtons = screen.getAllByRole("button", { name: /^Review:/ });
    expect(
      reviewButtons.map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Review: Employee Removals: 9",
      "Review: Loan Requests: 4",
      "Review: Leave Requests: 1",
      "Review: Attendance: 0",
      "Review: Damage Reports: 0",
      "Review: Return Requests: 0",
      "Review: Job Offers: 0",
      "Review: Contract decisions: 0",
      "Review: Annual Leave Payments: 0",
    ]);
  });

  it("marks a queue the CEO cannot read as unavailable rather than failing the page", async () => {
    getCeoApprovalSummary.mockResolvedValue(
      makeSummary({ leave: 2 }, ["employeeArchive"]),
    );

    render(<CEODashboardPage />);

    expect(
      await screen.findByRole("button", { name: /Leave Requests: 2/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Count unavailable. Open the queue or refresh to try again.",
      ),
    ).toBeInTheDocument();
    // Text label, not colour alone.
    expect(
      screen.queryByText("Nothing is waiting on you right now"),
    ).not.toBeInTheDocument();
  });

  it("renders a retryable error state when no queue can be read", async () => {
    getCeoApprovalSummary.mockResolvedValue(makeSummary({}, QUEUE_KEYS));

    render(<CEODashboardPage />);

    expect(
      await screen.findByText("Failed to load the approval overview"),
    ).toBeInTheDocument();

    getCeoApprovalSummary.mockResolvedValue(makeSummary({ leave: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Leave Requests: 1/ }),
      ).toBeInTheDocument(),
    );
  });

  it("navigates from a queue row into that approval area", async () => {
    getCeoApprovalSummary.mockResolvedValue(makeSummary({ loan: 2 }));

    render(<CEODashboardPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Review: Loan Requests: 2" }),
    );
    expect(navigateMock).toHaveBeenCalledWith("/ceo/loan-requests");
  });

  it("keeps announcements present without giving them the lead position", async () => {
    getCeoApprovalSummary.mockResolvedValue(makeSummary({ leave: 1 }));

    render(<CEODashboardPage />);

    expect(
      await screen.findByTestId("announcement-widget"),
    ).toBeInTheDocument();
  });

  it("refetches on refresh without tearing the page down", async () => {
    getCeoApprovalSummary.mockResolvedValue(makeSummary({ leave: 1 }));

    render(<CEODashboardPage />);
    await screen.findByRole("button", { name: /Leave Requests: 1/ });

    getCeoApprovalSummary.mockResolvedValue(makeSummary({ leave: 7 }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Leave Requests: 7/ }),
      ).toBeInTheDocument(),
    );
    expect(getCeoApprovalSummary).toHaveBeenCalledTimes(2);
  });

  it("renders Arabic labels when the language is Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getCeoApprovalSummary.mockResolvedValue(makeSummary({ leave: 1 }));

    render(<CEODashboardPage />);

    expect(await screen.findByText("مجالات الموافقة")).toBeInTheDocument();
    expect(screen.getAllByText("طلبات الإجازة").length).toBeGreaterThan(0);
  });
});

describe("CFODashboardPage", () => {
  it("shows the CFO queue using the shared dashboard without querying CEO data", async () => {
    vi.mocked(ceoSummaryApi.getCfoApprovalSummary).mockResolvedValue({
      queues: { loan: { key: "loan", count: 4, available: true } },
      totalPending: 4,
      allUnavailable: false,
    });
    render(<CFODashboardPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review: Loan Requests: 4" }),
    );
    expect(navigateMock).toHaveBeenCalledWith("/cfo/loan-requests");
    expect(getCeoApprovalSummary).not.toHaveBeenCalled();
    expect(screen.queryByText("Job Offers")).not.toBeInTheDocument();
  });
  it("does not show zero loans when the CFO count fails", async () => {
    vi.mocked(ceoSummaryApi.getCfoApprovalSummary).mockRejectedValue(
      new Error("offline"),
    );
    render(<CFODashboardPage />);
    expect(
      await screen.findByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing is waiting on you right now"),
    ).not.toBeInTheDocument();
  });
});
