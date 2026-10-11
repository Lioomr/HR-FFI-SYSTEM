import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "2" }),
}));

vi.mock("../../../services/api/leaveApi", () => ({
  getLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  sendLeaveRequestToCEO: vi.fn(),
  hrCancelLeaveRequest: vi.fn(),
  completeLeaveRequest: vi.fn(),
  getCEOLeaveRequest: vi.fn(),
  approveCEOLeaveRequest: vi.fn(),
  rejectCEOLeaveRequest: vi.fn(),
  getCEOLeaveRequestDocumentBlob: vi.fn(),
  getCEOLeaveRequestPdfBlob: vi.fn(),
  getLeaveRequestDocumentBlob: vi.fn(),
  getLeaveRequestPdfBlob: vi.fn(),
}));
vi.mock("../../../components/requests/RequestObligationsPanel", () => ({
  default: () => null,
}));
vi.mock("../../../components/documents/DocumentIntegrityPanel", () => ({
  default: () => null,
}));

import LeaveRequestDetailsPage from "./LeaveRequestDetailsPage";
import * as leaveApi from "../../../services/api/leaveApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const mocked = leaveApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const request = {
  id: 2,
  status: "pending_ceo",
  employee: { id: 7, full_name: "Sara Ahmed" },
  leave_type: { id: 1, name: "Annual" },
  start_date: "2026-10-01",
  end_date: "2026-10-05",
  days: 5,
  reason: "Family trip",
  created_at: "2026-09-20T09:00:00Z",
};

const ok = (data: unknown) => ({ status: "success" as const, data });

beforeEach(() => {
  navigateMock.mockClear();
  Object.values(mocked).forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
});

describe("LeaveRequestDetailsPage (CEO)", () => {
  it("approves from the sticky decision bar and returns to the inbox", async () => {
    mocked.getCEOLeaveRequest.mockResolvedValue(ok(request));
    mocked.approveCEOLeaveRequest.mockResolvedValue(
      ok({ ...request, status: "approved" }),
    );

    render(<LeaveRequestDetailsPage audience="ceo" />);

    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(
      within(bar).getByRole("button", { name: "Reject: Sara Ahmed" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(bar).getByRole("button", { name: "Approve: Sara Ahmed" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(mocked.approveCEOLeaveRequest).toHaveBeenCalledWith(
        2,
        undefined,
        undefined,
      ),
    );
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/ceo/leave/requests"),
    );
  });

  it("previews the request PDF inside the app, not in a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mocked.getCEOLeaveRequest.mockResolvedValue(ok(request));
    // Not a PDF or image, so the modal falls back to its download notice.
    mocked.getCEOLeaveRequestPdfBlob.mockResolvedValue(
      new Blob(["plain"], { type: "text/plain" }),
    );

    render(<LeaveRequestDetailsPage audience="ceo" />);

    fireEvent.click(await screen.findByRole("button", { name: /^Preview/ }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Preview PDF/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "This file cannot be previewed here. Download it to view.",
      ),
    ).toBeInTheDocument();
    expect(mocked.getCEOLeaveRequestPdfBlob).toHaveBeenCalledWith(2, false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("LeaveRequestDetailsPage (HR completion)", () => {
  it.each([false, null])(
    "completes a travel request without a visa upload when the answer is %s",
    async (willRequireVisa) => {
      mocked.getLeaveRequest.mockResolvedValue(
        ok({
          ...request,
          status: "pending_hr_completion",
          will_travel: true,
          will_require_visa: willRequireVisa,
          requires_hr_completion_visa: true,
          visa_upload_required: false,
        }),
      );
      mocked.completeLeaveRequest.mockResolvedValue(
        ok({ ...request, status: "approved" }),
      );

      render(<LeaveRequestDetailsPage />);
      fireEvent.click(
        await screen.findByRole("button", { name: /Complete & Approve/ }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByText("Upload Visa")).not.toBeInTheDocument();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Complete & Approve" }),
      );

      await waitFor(() =>
        expect(mocked.completeLeaveRequest).toHaveBeenCalledWith(2, {
          comment: undefined,
          visa_document: undefined,
        }),
      );
    },
  );

  it("requires a visa PDF when the backend marks the upload required", async () => {
    mocked.getLeaveRequest.mockResolvedValue(
      ok({
        ...request,
        status: "pending_hr_completion",
        will_travel: true,
        will_require_visa: true,
        requires_hr_completion_visa: true,
        visa_upload_required: true,
      }),
    );
    mocked.completeLeaveRequest.mockResolvedValue(
      ok({ ...request, status: "approved" }),
    );

    render(<LeaveRequestDetailsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Upload Visa to Approve/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Upload Visa")).toHaveLength(2);
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Upload Visa to Approve/ }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A visa PDF is required for this request.",
    );
    expect(mocked.completeLeaveRequest).not.toHaveBeenCalled();

    const invalidFile = new File(["not a PDF"], "visa.txt", {
      type: "text/plain",
    });
    fireEvent.change(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [invalidFile] },
      },
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Select a PDF file for the visa.",
    );

    const firstFile = new File(["%PDF-1.4"], "visa.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [firstFile] },
      },
    );
    expect(await within(dialog).findByText("visa.pdf")).toBeInTheDocument();

    const replacementFile = new File(["%PDF-1.5"], "replacement.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [replacementFile] },
      },
    );
    expect(
      await within(dialog).findByText("replacement.pdf"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("visa.pdf")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByTitle("Remove file"));
    expect(
      within(dialog).queryByText("replacement.pdf"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Upload Visa to Approve/ }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "A visa PDF is required for this request.",
    );
    fireEvent.change(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [replacementFile] },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Upload Visa to Approve/ }),
    );
    await waitFor(() =>
      expect(mocked.completeLeaveRequest).toHaveBeenCalledWith(2, {
        comment: undefined,
        visa_document: replacementFile,
      }),
    );
  });
});
