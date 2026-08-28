import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../services/api/managerApi", () => ({
  getManagerTeam: vi.fn(),
}));

import CEOTeamPage from "./CEOTeamPage";
import * as managerApi from "../../services/api/managerApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getManagerTeam = managerApi.getManagerTeam as unknown as ReturnType<
  typeof vi.fn
>;

const members = [
  {
    id: 1,
    employee_id: "FFI-001",
    full_name_en: "Sara Ahmed",
    email: "sara@ffi.test",
    mobile: "0500000001",
    department: "Finance",
    position: "Analyst",
  },
  {
    id: 2,
    employee_id: "FFI-002",
    full_name_en: "Omar Nasser",
    email: "omar@ffi.test",
    mobile: "0500000002",
    department: "Operations",
    position: "Supervisor",
  },
];

beforeEach(() => {
  getManagerTeam.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEOTeamPage", () => {
  it("lists team members", async () => {
    getManagerTeam.mockResolvedValue({
      status: "success" as const,
      data: members,
    });

    render(<CEOTeamPage />);

    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Omar Nasser")).toBeInTheDocument();
  });

  it("filters the list from the search field", async () => {
    getManagerTeam.mockResolvedValue({
      status: "success" as const,
      data: members,
    });

    render(<CEOTeamPage />);
    await screen.findByText("Sara Ahmed");

    fireEvent.change(
      screen.getByLabelText("Search by name, ID, department..."),
      {
        target: { value: "operations" },
      },
    );

    expect(screen.queryByText("Sara Ahmed")).not.toBeInTheDocument();
    expect(screen.getByText("Omar Nasser")).toBeInTheDocument();
  });

  it("distinguishes an empty team from an empty search result", async () => {
    getManagerTeam.mockResolvedValue({
      status: "success" as const,
      data: members,
    });

    render(<CEOTeamPage />);
    await screen.findByText("Sara Ahmed");

    fireEvent.change(
      screen.getByLabelText("Search by name, ID, department..."),
      {
        target: { value: "nobody" },
      },
    );
    expect(screen.getByText("No matching team members")).toBeInTheDocument();
  });

  it("shows the empty state when nobody reports to the CEO", async () => {
    getManagerTeam.mockResolvedValue({ status: "success" as const, data: [] });

    render(<CEOTeamPage />);

    expect(await screen.findByText("No team members yet")).toBeInTheDocument();
  });

  it("shows a retryable error state when the team fails to load", async () => {
    getManagerTeam.mockResolvedValue({
      status: "error" as const,
      message: "team service down",
    });

    render(<CEOTeamPage />);

    expect(await screen.findByText("team service down")).toBeInTheDocument();

    getManagerTeam.mockResolvedValue({
      status: "success" as const,
      data: members,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByText("Sara Ahmed")).toBeInTheDocument(),
    );
  });
});
