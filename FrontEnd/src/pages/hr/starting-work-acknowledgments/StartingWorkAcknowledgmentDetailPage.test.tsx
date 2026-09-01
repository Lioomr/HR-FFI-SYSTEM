import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "7" }),
}));

vi.mock(
  "../../../services/api/startingWorkAcknowledgmentsApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../services/api/startingWorkAcknowledgmentsApi")
    >()),
    getStartingWorkAcknowledgment: vi.fn(),
    approveStartingWorkAcknowledgment: vi.fn(),
    rejectStartingWorkAcknowledgment: vi.fn(),
    downloadStartingWorkAcknowledgmentPdf: vi.fn(),
  }),
);

vi.mock("../../../services/api/downloads", () => ({
  triggerBlobDownload: vi.fn(),
}));

import StartingWorkAcknowledgmentDetailPage from "./StartingWorkAcknowledgmentDetailPage";
import * as api from "../../../services/api/startingWorkAcknowledgmentsApi";
import * as downloads from "../../../services/api/downloads";
import { makeAcknowledgment, makeActions, makeWorkflow } from "./testFixtures";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const getAcknowledgment = vi.mocked(api.getStartingWorkAcknowledgment);
const approveAcknowledgment = vi.mocked(api.approveStartingWorkAcknowledgment);
const rejectAcknowledgment = vi.mocked(api.rejectStartingWorkAcknowledgment);
const downloadPdf = vi.mocked(api.downloadStartingWorkAcknowledgmentPdf);
const triggerBlobDownload = vi.mocked(downloads.triggerBlobDownload);

const detail = makeAcknowledgment({
  workflow: makeWorkflow({
    can_approve: true,
    can_reject: true,
    history: [
      {
        id: 1,
        action: "submit",
        actor: { id: 5, email: "system@ffi.test", full_name: "System" },
        at: "2026-08-24T05:30:00Z",
        note: "Generated from the first BioTime attendance.",
      },
    ],
  }),
});

const ok = (
  data: unknown,
  message?: string,
): { status: "success"; data: never; message?: string } =>
  ({ status: "success", data, message }) as never;

/** What an HTTP error looks like once axios has wrapped the response. */
const httpError = (status: number, message: string) => ({
  response: { status, data: { status: "error", message } },
});

beforeEach(() => {
  navigateMock.mockClear();
  getAcknowledgment.mockReset().mockResolvedValue(ok(detail));
  approveAcknowledgment.mockReset();
  rejectAcknowledgment.mockReset();
  downloadPdf.mockReset();
  triggerBlobDownload.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("StartingWorkAcknowledgmentDetailPage", () => {
  it("shows the record, the reviewer context and the workflow history", async () => {
    render(<StartingWorkAcknowledgmentDetailPage />);

    // The name is both the page title and the employee field.
    expect((await screen.findAllByText("Nora Khalid")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("FFI-0643")).toBeInTheDocument();
    expect(
      screen.getByText("Future Fence Industries (FFI)"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("FFI-064303-20260830").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("2026-08-24")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(
      screen.getByText("Generated from the first BioTime attendance."),
    ).toBeInTheDocument();
    expect(getAcknowledgment).toHaveBeenCalledWith("7");
  });

  it("explains that pending attendance does not count as worked time", async () => {
    render(<StartingWorkAcknowledgmentDetailPage />);

    expect(
      await screen.findByText(
        "This employee's BioTime attendance will not count as worked time for payroll until HR approves it.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the decision metadata and rejection reason once rejected", async () => {
    getAcknowledgment.mockResolvedValue(
      ok(
        makeAcknowledgment({
          status: "rejected",
          status_label: "Rejected",
          rejected_by: {
            id: 2,
            name: "Huda Ali",
            email: "huda@ffi.test",
          },
          rejected_at: "2026-08-25T08:00:00Z",
          rejection_reason: "BioTime attendance could not be verified.",
          actions: makeActions({ can_approve: true, can_download: true }),
        }),
      ),
    );

    render(<StartingWorkAcknowledgmentDetailPage />);

    expect(await screen.findByText("Huda Ali")).toBeInTheDocument();
    expect(screen.getByText("huda@ffi.test")).toBeInTheDocument();
    expect(
      screen.getByText("BioTime attendance could not be verified."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The affected BioTime attendance records are marked absent until HR approves a corrected verification.",
      ),
    ).toBeInTheDocument();
    // The re-approval path has to say what approving a rejected record does.
    expect(
      screen.getByText(
        "Approval restores eligible system attendance records to present. HR corrections are preserved.",
      ),
    ).toBeInTheDocument();
  });
});

describe("StartingWorkAcknowledgmentDetailPage actions", () => {
  it("renders every action the backend allows", async () => {
    render(<StartingWorkAcknowledgmentDetailPage />);

    expect(
      await screen.findByRole("button", {
        name: "Approve BioTime Verification",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject Verification" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download Acknowledgment" }),
    ).toBeInTheDocument();
  });

  it("renders no decision action when the backend allows none", async () => {
    getAcknowledgment.mockResolvedValue(
      ok(
        makeAcknowledgment({
          status: "approved",
          status_label: "Approved",
          actions: makeActions(),
        }),
      ),
    );

    render(<StartingWorkAcknowledgmentDetailPage />);
    await screen.findAllByText("Nora Khalid");

    expect(
      screen.queryByRole("button", { name: "Approve BioTime Verification" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject Verification" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download Acknowledgment" }),
    ).not.toBeInTheDocument();
  });

  it("offers approval but not rejection on a rejected acknowledgement", async () => {
    getAcknowledgment.mockResolvedValue(
      ok(
        makeAcknowledgment({
          status: "rejected",
          status_label: "Rejected",
          rejection_reason: "BioTime attendance could not be verified.",
          actions: makeActions({ can_approve: true, can_download: true }),
        }),
      ),
    );
    approveAcknowledgment.mockResolvedValue(
      ok(
        makeAcknowledgment({ status: "approved", actions: makeActions() }),
        "Starting work attendance approved.",
      ),
    );

    render(<StartingWorkAcknowledgmentDetailPage />);

    const approve = await screen.findByRole("button", {
      name: "Approve BioTime Verification",
    });
    expect(
      screen.queryByRole("button", { name: "Reject Verification" }),
    ).not.toBeInTheDocument();

    fireEvent.click(approve);

    await waitFor(() =>
      expect(approveAcknowledgment).toHaveBeenCalledWith("7"),
    );
    expect(
      await screen.findByText("Starting work attendance approved."),
    ).toBeInTheDocument();
    await waitFor(() => expect(getAcknowledgment).toHaveBeenCalledTimes(2));
  });

  it("downloads the PDF from the acknowledgement record", async () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    downloadPdf.mockResolvedValue(blob);

    render(<StartingWorkAcknowledgmentDetailPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Download Acknowledgment" }),
    );

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledWith(detail));
    expect(triggerBlobDownload).toHaveBeenCalledWith(
      blob,
      "starting_work_acknowledgment_FFI-064303-20260830.pdf",
    );
  });
});

describe("StartingWorkAcknowledgmentDetailPage rejection", () => {
  it("refuses to send a rejection without a reason", async () => {
    render(<StartingWorkAcknowledgmentDetailPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject Verification" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reject Verification" }),
    );

    expect(
      await screen.findByText("A rejection reason is required."),
    ).toBeInTheDocument();
    expect(rejectAcknowledgment).not.toHaveBeenCalled();
  });

  it("sends the typed reason and reloads the record", async () => {
    rejectAcknowledgment.mockResolvedValue(
      ok(
        makeAcknowledgment({
          status: "rejected",
          rejection_reason: "BioTime attendance could not be verified.",
          actions: makeActions({ can_approve: true }),
        }),
        "Starting work attendance rejected.",
      ),
    );

    render(<StartingWorkAcknowledgmentDetailPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject Verification" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Rejection reason"), {
      target: { value: "BioTime attendance could not be verified." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reject Verification" }),
    );

    await waitFor(() =>
      expect(rejectAcknowledgment).toHaveBeenCalledWith("7", {
        reason: "BioTime attendance could not be verified.",
      }),
    );
    expect(
      await screen.findByText("Starting work attendance rejected."),
    ).toBeInTheDocument();
    await waitFor(() => expect(getAcknowledgment).toHaveBeenCalledTimes(2));
  });
});

describe("StartingWorkAcknowledgmentDetailPage error handling", () => {
  it("treats a 409 as a stale view: it reports it and reloads", async () => {
    approveAcknowledgment.mockRejectedValue(
      httpError(409, "This acknowledgement has already been approved."),
    );

    render(<StartingWorkAcknowledgmentDetailPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Approve BioTime Verification",
      }),
    );

    expect(
      await screen.findByText(
        "This acknowledgement has already been approved.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(getAcknowledgment).toHaveBeenCalledTimes(2));
  });

  it("shows the not-found state on a 404", async () => {
    getAcknowledgment.mockRejectedValue(
      httpError(404, "Starting work acknowledgement not found."),
    );

    render(<StartingWorkAcknowledgmentDetailPage />);

    expect(
      await screen.findByText("This BioTime verification was not found."),
    ).toBeInTheDocument();
  });

  it("shows the unauthorized page on a 403", async () => {
    getAcknowledgment.mockRejectedValue(httpError(403, "Forbidden."));

    render(<StartingWorkAcknowledgmentDetailPage />);

    expect(await screen.findByText("403")).toBeInTheDocument();
  });
});
