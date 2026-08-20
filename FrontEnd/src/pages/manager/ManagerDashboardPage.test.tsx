import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
    useNavigate: () => navigateMock,
}));

vi.mock("../../services/api/managerSummaryApi", () => ({
    getManagerWorkSummary: vi.fn(),
    MANAGER_QUEUE_KEYS: ["leave", "loan", "attendance", "assetReturn"],
}));

vi.mock("../../services/api/managerApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/api/managerApi")>()),
    getManagerAccess: vi.fn(),
    getManagerTeam: vi.fn(),
}));

vi.mock("../../components/announcements/AnnouncementWidget", () => ({
    default: () => <div data-testid="announcement-widget" />,
}));

import ManagerDashboardPage from "./ManagerDashboardPage";
import { getManagerWorkSummary } from "../../services/api/managerSummaryApi";
import type {
    ManagerPendingItem,
    ManagerQueueKey,
    ManagerWorkSummary,
} from "../../services/api/managerSummaryApi";
import {
    getManagerAccess,
    getManagerTeam,
    type ManagerAccess,
    type ManagerTeamMember,
} from "../../services/api/managerApi";
import { resetManagerAccessCache } from "../../hooks/useManagerAccess";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";

const mockedSummary = vi.mocked(getManagerWorkSummary);
const mockedAccess = vi.mocked(getManagerAccess);
const mockedTeam = vi.mocked(getManagerTeam);

const QUEUE_KEYS: ManagerQueueKey[] = ["leave", "loan", "attendance", "assetReturn"];
const DAY = 86_400_000;

function daysAgo(days: number) {
    return new Date(Date.now() - days * DAY).toISOString();
}

function makeItem(overrides: Partial<ManagerPendingItem> & { queue: ManagerQueueKey }): ManagerPendingItem {
    return {
        key: `${overrides.queue}-${overrides.id ?? 1}`,
        id: 1,
        employeeName: "Sara Idris",
        employeeEmail: "sara@ffi.test",
        detail: "Annual",
        status: "pending_manager",
        submittedAt: daysAgo(1),
        path: "/manager/leave/requests/1",
        ...overrides,
    };
}

function makeSummary(
    items: ManagerPendingItem[] = [],
    unavailable: ManagerQueueKey[] = [],
): ManagerWorkSummary {
    const queues = {} as ManagerWorkSummary["queues"];
    QUEUE_KEYS.forEach((key) => {
        const available = !unavailable.includes(key);
        const queueItems = available ? items.filter((item) => item.queue === key) : [];
        queues[key] = { key, count: queueItems.length, available, items: queueItems };
    });
    const readable = items.filter((item) => !unavailable.includes(item.queue));
    return {
        queues,
        items: readable,
        totalPending: readable.length,
        allUnavailable: unavailable.length === QUEUE_KEYS.length,
    };
}

function setAccess(overrides: Partial<ManagerAccess> = {}) {
    mockedAccess.mockResolvedValue({
        status: "success",
        data: {
            has_access: true,
            managed_employee_count: 3,
            source: "direct_reports",
            scopes: ["leave"],
            ...overrides,
        },
    });
}

function setTeam(members: Partial<ManagerTeamMember>[] = []) {
    mockedTeam.mockResolvedValue({
        status: "success",
        data: members.map((member, index) => ({
            id: index + 1,
            employee_id: `E-${index + 1}`,
            ...member,
        })) as ManagerTeamMember[],
    });
}

describe("ManagerDashboardPage", () => {
    beforeEach(() => {
        resetManagerAccessCache();
        navigateMock.mockClear();
        mockedSummary.mockReset();
        mockedAccess.mockReset();
        mockedTeam.mockReset();
        useI18nStore.getState().setLanguage("en");
        setAccess();
        setTeam();
        mockedSummary.mockResolvedValue(makeSummary());
        useAuthStore.setState({
            isAuthenticated: true,
            user: { id: "21", email: "lead@ffi.test", role: "Employee" },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({ isAuthenticated: false, user: null });
    });

    it("reports the managed employee count and the pending total", async () => {
        setAccess({ managed_employee_count: 3 });
        mockedSummary.mockResolvedValue(
            makeSummary([
                makeItem({ queue: "leave", id: 1 }),
                makeItem({ queue: "loan", id: 2, detail: "5000" }),
                makeItem({ queue: "attendance", id: 3, detail: "2026-08-01" }),
            ]),
        );

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("3 employees report to you")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /Pending approvals: 3/ }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Leave requests: 1/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Direct reports: 3/ })).toBeInTheDocument();
    });

    it("lists the waiting requests in the priority queue with a review action", async () => {
        mockedSummary.mockResolvedValue(
            makeSummary([
                makeItem({
                    queue: "leave",
                    id: 7,
                    employeeName: "Sara Idris",
                    submittedAt: daysAgo(4),
                    path: "/manager/leave/requests/7",
                }),
            ]),
        );

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("Priority work queue")).toBeInTheDocument();
        expect(screen.getByText("Sara Idris")).toBeInTheDocument();
        expect(screen.getByText("4 days waiting")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Review: Sara Idris" }));
        expect(navigateMock).toHaveBeenCalledWith("/manager/leave/requests/7");
    });

    it("shows a compact all-clear state instead of an empty queue panel", async () => {
        mockedSummary.mockResolvedValue(makeSummary());

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("No pending team requests")).toBeInTheDocument();
        expect(
            screen.getByText("Your team has no requests waiting for your approval right now."),
        ).toBeInTheDocument();
        // Nothing to review, so the header CTA stays out of the way.
        expect(
            screen.queryByRole("button", { name: "Review pending requests" }),
        ).not.toBeInTheDocument();
    });

    it("offers the review call to action only while something is pending", async () => {
        mockedSummary.mockResolvedValue(makeSummary([makeItem({ queue: "leave", id: 1 })]));

        render(<ManagerDashboardPage />);

        fireEvent.click(await screen.findByRole("button", { name: "Review pending requests" }));
        expect(navigateMock).toHaveBeenCalledWith("/manager/team-requests");
    });

    it("previews the team and links through to a member profile", async () => {
        setTeam([
            { id: 11, full_name_en: "Sara Idris", position: "Site Engineer" },
            { id: 12, full_name_en: "Omar Nabil", position: "Foreman" },
        ]);

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("Team snapshot")).toBeInTheDocument();
        fireEvent.click(screen.getByText("Omar Nabil"));
        expect(navigateMock).toHaveBeenCalledWith("/manager/team/12");
    });

    it("marks an unreadable queue as unavailable rather than failing the page", async () => {
        mockedSummary.mockResolvedValue(
            makeSummary([makeItem({ queue: "leave", id: 1 })], ["assetReturn"]),
        );

        render(<ManagerDashboardPage />);

        expect(await screen.findByRole("button", { name: /Leave requests: 1/ })).toBeInTheDocument();
        expect(screen.getByText("Unavailable")).toBeInTheDocument();
        expect(
            screen.getByText("Some queues could not be read, so the totals below may be incomplete."),
        ).toBeInTheDocument();
    });

    it("renders a retryable error when no queue can be read", async () => {
        mockedSummary.mockResolvedValue(makeSummary([], QUEUE_KEYS));

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("Could not load your team overview")).toBeInTheDocument();

        mockedSummary.mockResolvedValue(makeSummary([makeItem({ queue: "leave", id: 1 })]));
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(screen.getByRole("button", { name: /Leave requests: 1/ })).toBeInTheDocument(),
        );
    });

    it("tells a capability holder with no assigned employees that nobody reports to them", async () => {
        setAccess({ managed_employee_count: 0 });

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("No employees assigned to you yet")).toBeInTheDocument();
        expect(screen.queryByText("Priority work queue")).not.toBeInTheDocument();
    });

    it("keeps announcements present without giving them the lead position", async () => {
        render(<ManagerDashboardPage />);

        expect(await screen.findByTestId("announcement-widget")).toBeInTheDocument();
    });

    it("renders Arabic labels when the language is Arabic", async () => {
        useI18nStore.getState().setLanguage("ar");
        mockedSummary.mockResolvedValue(makeSummary([makeItem({ queue: "leave", id: 1 })]));

        render(<ManagerDashboardPage />);

        expect(await screen.findByText("قائمة العمل حسب الأولوية")).toBeInTheDocument();
        expect(screen.getByText("لمحة عن الفريق")).toBeInTheDocument();
    });
});
