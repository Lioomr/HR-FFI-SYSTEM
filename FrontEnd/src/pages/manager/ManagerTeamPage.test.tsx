import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
    useNavigate: () => navigateMock,
}));

vi.mock("../../services/api/managerApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/api/managerApi")>()),
    getManagerAccess: vi.fn(),
    getManagerTeam: vi.fn(),
}));

import ManagerTeamPage from "./ManagerTeamPage";
import {
    getManagerAccess,
    getManagerTeam,
    type ManagerTeamMember,
} from "../../services/api/managerApi";
import { resetManagerAccessCache } from "../../hooks/useManagerAccess";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";

const mockedAccess = vi.mocked(getManagerAccess);
const mockedTeam = vi.mocked(getManagerTeam);

const TEAM: ManagerTeamMember[] = [
    {
        id: 11,
        employee_id: "E-1001",
        full_name_en: "Sara Idris",
        email: "sara@ffi.test",
        mobile: "0500000001",
        department: "Operations",
        position: "Site Engineer",
        employment_status: "ACTIVE",
    },
    {
        id: 12,
        employee_id: "E-1002",
        full_name_en: "Omar Nabil",
        email: "omar@ffi.test",
        mobile: "0500000002",
        department: "Logistics",
        position: "Foreman",
    },
];

function setAccess(managedEmployeeCount: number) {
    mockedAccess.mockResolvedValue({
        status: "success",
        data: {
            has_access: true,
            managed_employee_count: managedEmployeeCount,
            source: "direct_reports",
            scopes: ["leave"],
        },
    });
}

describe("ManagerTeamPage", () => {
    beforeEach(() => {
        resetManagerAccessCache();
        navigateMock.mockClear();
        mockedAccess.mockReset();
        mockedTeam.mockReset();
        useI18nStore.getState().setLanguage("en");
        setAccess(2);
        mockedTeam.mockResolvedValue({ status: "success", data: TEAM });
        useAuthStore.setState({
            isAuthenticated: true,
            user: { id: "21", email: "lead@ffi.test", role: "Employee" },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({ isAuthenticated: false, user: null });
    });

    it("lists direct reports with their identifying details", async () => {
        render(<ManagerTeamPage />);

        expect(await screen.findByText("Sara Idris")).toBeInTheDocument();
        expect(screen.getByText("E-1001")).toBeInTheDocument();
        expect(screen.getByText("Site Engineer")).toBeInTheDocument();
        expect(screen.getByText("ACTIVE")).toBeInTheDocument();
        expect(screen.getByText("2 employees report to you")).toBeInTheDocument();
    });

    it("filters the table by the search box", async () => {
        render(<ManagerTeamPage />);
        await screen.findByText("Sara Idris");

        fireEvent.change(screen.getByRole("textbox", { name: /Search by name/ }), {
            target: { value: "omar" },
        });

        await waitFor(() => expect(screen.queryByText("Sara Idris")).not.toBeInTheDocument());
        expect(screen.getByText("Omar Nabil")).toBeInTheDocument();
    });

    it("shows a distinct empty state when the filters match nobody", async () => {
        render(<ManagerTeamPage />);
        await screen.findByText("Sara Idris");

        fireEvent.change(screen.getByRole("textbox", { name: /Search by name/ }), {
            target: { value: "nobody-by-this-name" },
        });

        expect(await screen.findByText("No team members match your filters")).toBeInTheDocument();
        // Not the "HR has assigned nobody" message, which means something else.
        expect(screen.queryByText("No employees assigned to you yet")).not.toBeInTheDocument();
    });

    it("clears the filters and restores every row", async () => {
        render(<ManagerTeamPage />);
        await screen.findByText("Sara Idris");

        fireEvent.change(screen.getByRole("textbox", { name: /Search by name/ }), {
            target: { value: "omar" },
        });
        await waitFor(() => expect(screen.queryByText("Sara Idris")).not.toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

        expect(await screen.findByText("Sara Idris")).toBeInTheDocument();
        expect(screen.getByText("Omar Nabil")).toBeInTheDocument();
    });

    it("tells the manager HR has assigned nobody when the team is empty", async () => {
        setAccess(0);
        mockedTeam.mockResolvedValue({ status: "success", data: [] });

        render(<ManagerTeamPage />);

        expect(await screen.findByText("No employees assigned to you yet")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Nobody is currently assigned to you as their direct manager. Once HR assigns direct reports, they appear here.",
            ),
        ).toBeInTheDocument();
    });

    it("opens the read-only profile from the row action", async () => {
        render(<ManagerTeamPage />);
        await screen.findByText("Sara Idris");

        fireEvent.click(screen.getByRole("button", { name: "View profile: Omar Nabil" }));
        expect(navigateMock).toHaveBeenCalledWith("/manager/team/12");
    });
});
