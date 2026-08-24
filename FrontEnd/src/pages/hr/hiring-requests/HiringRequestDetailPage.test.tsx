import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: "1" }),
}));

vi.mock("../../../services/api/hiringRequestsApi", () => ({
  getHiringRequest: vi.fn(),
  submitHiringRequest: vi.fn(),
  cancelHiringRequest: vi.fn(),
  downloadHiringRequestCv: vi.fn(),
}));

vi.mock("../../../services/api/downloads", () => ({ triggerBlobDownload: vi.fn() }));

import HiringRequestDetailPage from "./HiringRequestDetailPage";
import * as hiringRequestsApi from "../../../services/api/hiringRequestsApi";
import * as downloads from "../../../services/api/downloads";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";
import { makeHiringRequest, makeWorkflow, ok } from "./testFixtures";

const getHiringRequest = hiringRequestsApi.getHiringRequest as unknown as ReturnType<typeof vi.fn>;
const downloadHiringRequestCv = hiringRequestsApi.downloadHiringRequestCv as unknown as ReturnType<
  typeof vi.fn
>;
const triggerBlobDownload = downloads.triggerBlobDownload as unknown as ReturnType<typeof vi.fn>;

/** The candidate name renders twice, so settle on all of its matches. */
const waitForLoaded = () => screen.findAllByText("Nora Khalid");

/** Workflow flags as the backend reports them once a request leaves draft. */
const terminalWorkflow = makeWorkflow({ can_edit: false, can_submit: false, can_cancel: false });

beforeEach(() => {
  navigateMock.mockClear();
  getHiringRequest.mockReset();
  downloadHiringRequestCv.mockReset();
  triggerBlobDownload.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("HiringRequestDetailPage", () => {
  it("shows the candidate summary for a draft", async () => {
    getHiringRequest.mockResolvedValue(ok(makeHiringRequest()));

    render(<HiringRequestDetailPage />);

    expect(await screen.findAllByText("Nora Khalid")).not.toHaveLength(0);
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("Reference HR-2026-001")).toBeInTheDocument();
  });

  it("offers edit, submit and cancel while the workflow allows them", async () => {
    getHiringRequest.mockResolvedValue(ok(makeHiringRequest()));

    render(<HiringRequestDetailPage />);
    await waitForLoaded();

    expect(screen.getByRole("button", { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit to CEO/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel Request/i })).toBeInTheDocument();
  });

  it("hides those actions when the workflow withholds them", async () => {
    getHiringRequest.mockResolvedValue(
      ok(makeHiringRequest({ status: "submitted", workflow: terminalWorkflow })),
    );

    render(<HiringRequestDetailPage />);
    await waitForLoaded();

    expect(screen.queryByRole("button", { name: /Edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit to CEO/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel Request/i })).not.toBeInTheDocument();
  });

  it("offers the CV download only when a CV is attached", async () => {
    getHiringRequest.mockResolvedValue(ok(makeHiringRequest({ has_cv: false })));

    const view = render(<HiringRequestDetailPage />);
    await waitForLoaded();
    expect(screen.queryByRole("button", { name: /Download CV/i })).not.toBeInTheDocument();
    expect(screen.getByText("No CV attached.")).toBeInTheDocument();

    view.unmount();
    getHiringRequest.mockResolvedValue(ok(makeHiringRequest({ has_cv: true })));
    render(<HiringRequestDetailPage />);
    await waitForLoaded();
    expect(screen.getByRole("button", { name: /Download CV/i })).toBeInTheDocument();
  });

  it("downloads the CV as a file", async () => {
    getHiringRequest.mockResolvedValue(ok(makeHiringRequest()));
    const blob = new Blob(["cv"], { type: "application/pdf" });
    downloadHiringRequestCv.mockResolvedValue(blob);

    render(<HiringRequestDetailPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Download CV/i }));

    await waitFor(() => expect(downloadHiringRequestCv).toHaveBeenCalledWith("1"));
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, "hiring_request_1_cv");
  });

  it("offers Create Job Offer once approved and not yet converted", async () => {
    getHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "approved",
          job_offer_id: null,
          workflow: terminalWorkflow,
          ceo_decision_at: "2026-08-05T10:00:00Z",
          ceo_decision_by_name: "Chief Exec",
          ceo_decision_note: "Approved for Q4 headcount.",
        }),
      ),
    );

    render(<HiringRequestDetailPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Create Job Offer/i }));

    expect(navigateMock).toHaveBeenCalledWith("/hr/job-offers/new?hiring_request_id=1");
    expect(screen.getByText("Approved for Q4 headcount.")).toBeInTheDocument();
  });

  it("links to the offer once the request is converted", async () => {
    getHiringRequest.mockResolvedValue(
      ok(makeHiringRequest({ status: "converted", job_offer_id: 44, workflow: terminalWorkflow })),
    );

    render(<HiringRequestDetailPage />);
    await waitForLoaded();

    expect(screen.queryByRole("button", { name: /Create Job Offer/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open Job Offer/i }));
    expect(navigateMock).toHaveBeenCalledWith("/hr/job-offers/44");
  });

  it.each(["rejected", "cancelled"] as const)(
    "does not offer an offer path from a %s request",
    async (status) => {
      getHiringRequest.mockResolvedValue(
        ok(makeHiringRequest({ status, workflow: terminalWorkflow })),
      );

      render(<HiringRequestDetailPage />);
      await waitForLoaded();

      expect(screen.queryByRole("button", { name: /Create Job Offer/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Open Job Offer/i })).not.toBeInTheDocument();
    },
  );
});
