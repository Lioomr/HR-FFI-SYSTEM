import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../services/api/hiringRequestsApi", () => ({
  listHiringRequests: vi.fn(),
}));

import HiringRequestsListPage from "./HiringRequestsListPage";
import * as hiringRequestsApi from "../../../services/api/hiringRequestsApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";
import { makeHiringRequest, okList } from "./testFixtures";

const listHiringRequests = hiringRequestsApi.listHiringRequests as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigateMock.mockClear();
  listHiringRequests.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("HiringRequestsListPage", () => {
  it("loads the first page and renders each request", async () => {
    listHiringRequests.mockResolvedValue(okList([makeHiringRequest()]));

    render(<HiringRequestsListPage />);

    expect(await screen.findByText("Nora Khalid")).toBeInTheDocument();
    expect(screen.getByText("HR-2026-001")).toBeInTheDocument();
    expect(screen.getByText("FFI")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(listHiringRequests).toHaveBeenCalledWith({ page: 1, page_size: 25 });
  });

  it("sends the chosen status as a query param", async () => {
    listHiringRequests.mockResolvedValue(okList([makeHiringRequest()]));

    render(<HiringRequestsListPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByText("Approved"));

    await waitFor(() =>
      expect(listHiringRequests).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 25,
        status: "approved",
      }),
    );
  });

  it("sends the search term as a query param", async () => {
    listHiringRequests.mockResolvedValue(okList([makeHiringRequest()]));

    render(<HiringRequestsListPage />);
    await screen.findByText("Nora Khalid");

    const search = screen.getByLabelText("Search by candidate, email or reference number");
    fireEvent.change(search, { target: { value: "  nora  " } });
    fireEvent.keyDown(search, { key: "Enter", code: "Enter", keyCode: 13 });

    await waitFor(() =>
      // The term is normalized before it leaves the client.
      expect(listHiringRequests).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 25,
        search: "nora",
      }),
    );
  });

  it("shows every status the workflow can reach as a filter", async () => {
    listHiringRequests.mockResolvedValue(okList([]));

    render(<HiringRequestsListPage />);
    await screen.findByText("No hiring requests yet");

    ["All", "Draft", "Submitted", "Approved", "Rejected", "Converted", "Cancelled"].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
  });

  it("distinguishes an empty queue from an empty filter result", async () => {
    listHiringRequests.mockResolvedValue(okList([]));

    render(<HiringRequestsListPage />);
    expect(await screen.findByText("No hiring requests yet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Rejected"));

    expect(await screen.findByText("No requests match these filters")).toBeInTheDocument();
  });

  it("falls back to the translated error when the response is not an envelope", async () => {
    listHiringRequests.mockResolvedValue("<!doctype html><html></html>");

    render(<HiringRequestsListPage />);

    expect(await screen.findByText("Could not load hiring requests.")).toBeInTheDocument();
  });
});
