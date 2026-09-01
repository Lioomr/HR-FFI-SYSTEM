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
}));

vi.mock(
  "../../../services/api/startingWorkAcknowledgmentsApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../services/api/startingWorkAcknowledgmentsApi")
    >()),
    listStartingWorkAcknowledgments: vi.fn(),
    approveStartingWorkAcknowledgment: vi.fn(),
    downloadStartingWorkAcknowledgmentPdf: vi.fn(),
  }),
);

vi.mock("../../../services/api/downloads", () => ({
  triggerBlobDownload: vi.fn(),
}));

import StartingWorkAcknowledgmentsListPage from "./StartingWorkAcknowledgmentsListPage";
import * as api from "../../../services/api/startingWorkAcknowledgmentsApi";
import type { StartingWorkAcknowledgment } from "../../../services/api/startingWorkAcknowledgmentsApi";
import * as downloads from "../../../services/api/downloads";
import { makeAcknowledgment, makeActions } from "./testFixtures";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const listAcknowledgments = vi.mocked(api.listStartingWorkAcknowledgments);
const approveAcknowledgment = vi.mocked(api.approveStartingWorkAcknowledgment);
const downloadPdf = vi.mocked(api.downloadStartingWorkAcknowledgmentPdf);
const triggerBlobDownload = vi.mocked(downloads.triggerBlobDownload);

const pending = makeAcknowledgment();

const rejected = makeAcknowledgment({
  id: 8,
  status: "rejected",
  status_label: "Rejected",
  employee: { id: 43, employee_id: "FFI-0644", name: "Omar Saleh" },
  rejection_reason: "BioTime attendance could not be verified.",
  rejected_at: "2026-08-25T08:00:00Z",
  // The backend re-opens approval on a rejected record once HR has corrected
  // the attendance, but never re-opens rejection.
  actions: makeActions({ can_approve: true, can_download: true }),
});

const ok = (items: StartingWorkAcknowledgment[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 25, count: items.length, total_pages: 1 },
});

beforeEach(() => {
  navigateMock.mockClear();
  listAcknowledgments.mockReset();
  approveAcknowledgment.mockReset();
  downloadPdf.mockReset();
  triggerBlobDownload.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("StartingWorkAcknowledgmentsListPage", () => {
  it("defaults to the pending HR filter", async () => {
    listAcknowledgments.mockResolvedValue(ok([pending]));

    render(<StartingWorkAcknowledgmentsListPage />);

    await screen.findByText("Nora Khalid");
    expect(listAcknowledgments).toHaveBeenCalledWith({
      page: 1,
      page_size: 25,
      status: "pending_hr",
    });
  });

  it("renders the row detail the reviewer needs", async () => {
    listAcknowledgments.mockResolvedValue(ok([pending]));

    render(<StartingWorkAcknowledgmentsListPage />);

    expect(await screen.findByText("Nora Khalid")).toBeInTheDocument();
    expect(screen.getByText("FFI-0643")).toBeInTheDocument();
    expect(screen.getByText("FFI-064303-20260830")).toBeInTheDocument();
    expect(screen.getByText("2026-08-24")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("tells the reviewer that a pending row is held from payroll", async () => {
    listAcknowledgments.mockResolvedValue(ok([pending]));

    render(<StartingWorkAcknowledgmentsListPage />);

    expect(
      await screen.findByText(
        "Attendance is held from payroll until HR approval.",
      ),
    ).toBeInTheDocument();
  });

  it("switches the status sent to the backend", async () => {
    listAcknowledgments.mockResolvedValue(ok([pending]));

    render(<StartingWorkAcknowledgmentsListPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByText("Approved"));
    await waitFor(() =>
      expect(listAcknowledgments).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 25,
        status: "approved",
      }),
    );

    fireEvent.click(screen.getAllByText("Rejected")[0]);
    await waitFor(() =>
      expect(listAcknowledgments).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 25,
        status: "rejected",
      }),
    );
  });

  it("shows the rejection reason on a rejected row", async () => {
    listAcknowledgments.mockResolvedValue(ok([rejected]));

    render(<StartingWorkAcknowledgmentsListPage />);

    expect(
      await screen.findByText(
        "Rejection reason: BioTime attendance could not be verified.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the detail page when the row is clicked", async () => {
    listAcknowledgments.mockResolvedValue(ok([pending]));

    render(<StartingWorkAcknowledgmentsListPage />);

    fireEvent.click(await screen.findByText("Nora Khalid"));

    expect(navigateMock).toHaveBeenCalledWith(
      "/hr/starting-work-acknowledgments/7",
    );
  });

  it("shows the empty state when nothing is pending", async () => {
    listAcknowledgments.mockResolvedValue(ok([]));

    render(<StartingWorkAcknowledgmentsListPage />);

    expect(
      await screen.findByText("No BioTime verifications yet"),
    ).toBeInTheDocument();
  });
});

describe("StartingWorkAcknowledgmentsListPage actions", () => {
  it("renders only the actions the backend allows", async () => {
    const locked = makeAcknowledgment({ id: 9, actions: makeActions() });
    listAcknowledgments.mockResolvedValue(ok([locked]));

    render(<StartingWorkAcknowledgmentsListPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByLabelText("View: Nora Khalid")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Approve BioTime Verification: Nora Khalid"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Download Acknowledgment: Nora Khalid"),
    ).not.toBeInTheDocument();
  });

  it("lets HR approve a rejected acknowledgement later", async () => {
    listAcknowledgments.mockResolvedValue(ok([rejected]));
    approveAcknowledgment.mockResolvedValue({
      status: "success",
      message: "Starting work attendance approved.",
      data: makeAcknowledgment({ id: 8, status: "approved" }),
    });

    render(<StartingWorkAcknowledgmentsListPage />);
    await screen.findByText("Omar Saleh");

    fireEvent.click(
      screen.getByLabelText("Approve BioTime Verification: Omar Saleh"),
    );

    const dialog = await screen.findByRole("dialog");
    expect(approveAcknowledgment).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Approve BioTime Verification",
      }),
    );

    await waitFor(() => expect(approveAcknowledgment).toHaveBeenCalledWith(8));
    // The decision is reloaded rather than patched in locally.
    await waitFor(() => expect(listAcknowledgments).toHaveBeenCalledTimes(2));
  });

  it("downloads the acknowledgement PDF from the record download URL", async () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    listAcknowledgments.mockResolvedValue(ok([pending]));
    downloadPdf.mockResolvedValue(blob);

    render(<StartingWorkAcknowledgmentsListPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(
      screen.getByLabelText("Download Acknowledgment: Nora Khalid"),
    );

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledWith(pending));
    expect(triggerBlobDownload).toHaveBeenCalledWith(
      blob,
      "starting_work_acknowledgment_FFI-064303-20260830.pdf",
    );
  });
});
