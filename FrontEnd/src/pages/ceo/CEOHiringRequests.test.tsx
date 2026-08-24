import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "1" }),
}));

vi.mock("../../services/api/hiringRequestsApi", () => ({
  listHiringRequests: vi.fn(),
  getHiringRequest: vi.fn(),
  approveHiringRequest: vi.fn(),
  rejectHiringRequest: vi.fn(),
  downloadHiringRequestCv: vi.fn(),
}));

vi.mock("../../services/api/downloads", () => ({ triggerBlobDownload: vi.fn() }));

import CEOHiringRequestsInboxPage from "./CEOHiringRequestsInboxPage";
import CEOHiringRequestDetailPage from "./CEOHiringRequestDetailPage";
import * as hiringRequestsApi from "../../services/api/hiringRequestsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";
import {
  makeHiringRequest,
  makeWorkflow,
  ok,
  okList,
} from "../hr/hiring-requests/testFixtures";

const listHiringRequests = hiringRequestsApi.listHiringRequests as unknown as ReturnType<typeof vi.fn>;
const getHiringRequest = hiringRequestsApi.getHiringRequest as unknown as ReturnType<typeof vi.fn>;
const approveHiringRequest = hiringRequestsApi.approveHiringRequest as unknown as ReturnType<
  typeof vi.fn
>;
const rejectHiringRequest = hiringRequestsApi.rejectHiringRequest as unknown as ReturnType<typeof vi.fn>;

/** What the backend reports to the CEO who is the assigned approver. */
const pendingForCeo = makeWorkflow({
  status: "submitted",
  can_approve: true,
  can_reject: true,
  can_edit: false,
  can_submit: false,
  can_cancel: false,
  current_approver_role: "CEO",
});

const submitted = () =>
  makeHiringRequest({
    status: "submitted",
    submitted_at: "2026-08-03T09:00:00Z",
    workflow: pendingForCeo,
  });

const waitForLoaded = () => screen.findAllByText("Nora Khalid");

beforeEach(() => {
  navigateMock.mockClear();
  listHiringRequests.mockReset();
  getHiringRequest.mockReset();
  approveHiringRequest.mockReset();
  rejectHiringRequest.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "9", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEOHiringRequestsInboxPage", () => {
  it("opens on the submitted queue and renders what is waiting", async () => {
    listHiringRequests.mockResolvedValue(okList([submitted()]));

    render(<CEOHiringRequestsInboxPage />);

    expect(await screen.findByText("Nora Khalid")).toBeInTheDocument();
    expect(screen.getByText("HR-2026-001")).toBeInTheDocument();
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(listHiringRequests).toHaveBeenCalledWith({
      status: "submitted",
      page: 1,
      page_size: 20,
    });
  });

  it("opens the request from the review action", async () => {
    listHiringRequests.mockResolvedValue(okList([submitted()]));

    render(<CEOHiringRequestsInboxPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByLabelText("Review: Nora Khalid"));

    expect(navigateMock).toHaveBeenCalledWith("/ceo/hiring-requests/1");
  });
});

describe("CEOHiringRequestDetailPage", () => {
  it("shows everything the decision needs", async () => {
    getHiringRequest.mockResolvedValue(ok(submitted()));

    render(<CEOHiringRequestDetailPage />);
    await waitForLoaded();

    expect(screen.getByText("Saudi Arabia")).toBeInTheDocument();
    expect(screen.getByText("1995-04-12")).toBeInTheDocument();
    expect(screen.getByText("nora@example.com")).toBeInTheDocument();
    expect(screen.getByText("+966501234567")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download CV/i })).toBeInTheDocument();
  });

  it("approves through the approve endpoint", async () => {
    getHiringRequest.mockResolvedValue(ok(submitted()));
    approveHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "approved",
          ceo_decision_at: "2026-08-05T10:00:00Z",
          ceo_decision_by_name: "Chief Exec",
        }),
      ),
    );

    render(<CEOHiringRequestDetailPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));

    await waitFor(() => expect(approveHiringRequest).toHaveBeenCalledWith("1", {}));
    expect(await screen.findByText("Approved by Chief Exec")).toBeInTheDocument();
  });

  it("requires a note before a rejection is sent", async () => {
    getHiringRequest.mockResolvedValue(ok(submitted()));

    render(<CEOHiringRequestDetailPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /^Reject$/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    expect(rejectHiringRequest).not.toHaveBeenCalled();
  });

  it("rejects with the note the CEO wrote", async () => {
    getHiringRequest.mockResolvedValue(ok(submitted()));
    rejectHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "rejected",
          ceo_decision_at: "2026-08-05T10:00:00Z",
          ceo_decision_by_name: "Chief Exec",
          ceo_decision_note: "Budget frozen",
        }),
      ),
    );

    render(<CEOHiringRequestDetailPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "Budget frozen" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reject$/i }));

    await waitFor(() =>
      expect(rejectHiringRequest).toHaveBeenCalledWith("1", { note: "Budget frozen" }),
    );
    expect(await screen.findByText("Rejected by Chief Exec")).toBeInTheDocument();
  });

  it("offers no decision controls when the request is not waiting on this CEO", async () => {
    getHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "submitted",
          workflow: makeWorkflow({
            can_approve: false,
            can_reject: false,
            can_edit: false,
            can_submit: false,
            can_cancel: false,
          }),
        }),
      ),
    );

    render(<CEOHiringRequestDetailPage />);
    await waitForLoaded();

    expect(screen.queryByRole("button", { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.getByText("This request is not waiting on you.")).toBeInTheDocument();
  });
});
