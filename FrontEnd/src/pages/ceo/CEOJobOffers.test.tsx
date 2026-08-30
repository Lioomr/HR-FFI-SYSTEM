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
  useParams: () => ({ id: "11" }),
}));

vi.mock("../../services/api/jobOffersApi", () => ({
  listJobOffers: vi.fn(),
  getJobOffer: vi.fn(),
  approveJobOffer: vi.fn(),
  rejectJobOffer: vi.fn(),
  requestJobOfferChanges: vi.fn(),
  updateJobOffer: vi.fn(),
  downloadJobOfferCv: vi.fn(),
}));

vi.mock("../../services/api/downloads", () => ({
  triggerBlobDownload: vi.fn(),
}));
vi.mock("../../services/api/departmentsApi", () => ({
  listDepartments: vi.fn(),
}));
vi.mock("../../services/api/positionsApi", () => ({ listPositions: vi.fn() }));

import CEOJobOffersInboxPage from "./CEOJobOffersInboxPage";
import CEOJobOfferDetailPage from "./CEOJobOfferDetailPage";
import * as jobOffersApi from "../../services/api/jobOffersApi";
import * as downloads from "../../services/api/downloads";
import * as departmentsApi from "../../services/api/departmentsApi";
import * as positionsApi from "../../services/api/positionsApi";
import { makeJobOffer, makeWorkflow } from "../hr/job-offers/testFixtures";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const listJobOffers = jobOffersApi.listJobOffers as unknown as ReturnType<
  typeof vi.fn
>;
const getJobOffer = jobOffersApi.getJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const approveJobOffer = jobOffersApi.approveJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const rejectJobOffer = jobOffersApi.rejectJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const requestJobOfferChanges =
  jobOffersApi.requestJobOfferChanges as unknown as ReturnType<typeof vi.fn>;
const updateJobOffer = jobOffersApi.updateJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const downloadJobOfferCv =
  jobOffersApi.downloadJobOfferCv as unknown as ReturnType<typeof vi.fn>;
const triggerBlobDownload =
  downloads.triggerBlobDownload as unknown as ReturnType<typeof vi.fn>;
const listDepartments = departmentsApi.listDepartments as unknown as ReturnType<
  typeof vi.fn
>;
const listPositions = positionsApi.listPositions as unknown as ReturnType<
  typeof vi.fn
>;

const ok = <T,>(data: T) => ({ status: "success" as const, data });
const page = (items: unknown[]) =>
  ok({ items, page: 1, page_size: 20, count: items.length, total_pages: 1 });

/** Waiting on this CEO: every decision gate the backend can open is open. */
const pendingOffer = makeJobOffer({
  approval_status: "pending_ceo",
  approval_status_label: "Pending CEO",
  submitted_at: "2026-08-02T07:00:00Z",
  workflow: makeWorkflow({
    can_approve: true,
    can_reject: true,
    can_request_changes: true,
    can_edit: true,
  }),
});

beforeEach(() => {
  navigateMock.mockClear();
  listJobOffers.mockReset();
  getJobOffer.mockReset();
  approveJobOffer.mockReset();
  rejectJobOffer.mockReset();
  requestJobOfferChanges.mockReset();
  updateJobOffer.mockReset();
  downloadJobOfferCv.mockReset();
  triggerBlobDownload.mockReset();
  listDepartments
    .mockReset()
    .mockResolvedValue(ok([{ id: 3, name: "Projects", code: "PRJ" }]));
  listPositions
    .mockReset()
    .mockResolvedValue(ok([{ id: 8, name: "Project Engineer", code: "PE" }]));
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "9", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEOJobOffersInboxPage", () => {
  it("opens on the offers awaiting a CEO decision", async () => {
    listJobOffers.mockResolvedValue(page([pendingOffer]));

    render(<CEOJobOffersInboxPage />);

    expect(await screen.findByText("Nora Khalid")).toBeInTheDocument();
    expect(listJobOffers).toHaveBeenCalledWith({
      approval_status: "pending_ceo",
      page: 1,
      page_size: 20,
    });
  });

  it("switches to the decided tabs", async () => {
    listJobOffers.mockResolvedValue(page([pendingOffer]));

    render(<CEOJobOffersInboxPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByText("CEO approved"));

    await waitFor(() =>
      expect(listJobOffers).toHaveBeenLastCalledWith({
        approval_status: "approved",
        page: 1,
        page_size: 20,
      }),
    );
  });

  it("opens the full review screen for a row", async () => {
    listJobOffers.mockResolvedValue(page([pendingOffer]));

    render(<CEOJobOffersInboxPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByLabelText("Review: Nora Khalid"));

    expect(navigateMock).toHaveBeenCalledWith("/ceo/job-offers/11");
  });
});

describe("CEOJobOfferDetailPage review", () => {
  it("shows the whole package the CEO is deciding on", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));

    render(<CEOJobOfferDetailPage />);

    // The name shows in the header and again in the candidate table.
    expect(await screen.findAllByText("Nora Khalid")).not.toHaveLength(0);
    expect(screen.getByText("nora@example.com")).toBeInTheDocument();
    expect(screen.getByText("13,500")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("Class A")).toBeInTheDocument();
    expect(screen.getAllByText("Riyadh").length).toBeGreaterThan(0);
  });

  it("downloads the candidate CV through the authenticated endpoint", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    const blob = new Blob(["cv"], { type: "application/pdf" });
    downloadJobOfferCv.mockResolvedValue(blob);

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(screen.getAllByRole("button", { name: /Download CV/i })[0]);

    await waitFor(() => expect(downloadJobOfferCv).toHaveBeenCalledWith("11"));
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, "job_offer_11_cv");
  });

  it("approves with an empty recommendation by default", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    approveJobOffer.mockResolvedValue(
      ok(
        makeJobOffer({
          approval_status: "approved",
          approval_status_label: "Approved",
          ceo_decision_by_name: "Chief Exec",
          ceo_decision_at: "2026-08-02T09:00:00Z",
          workflow: makeWorkflow(),
        }),
      ),
    );

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(screen.getByLabelText("Approve: Nora Khalid"));

    await waitFor(() => expect(approveJobOffer).toHaveBeenCalledWith("11", {}));
    expect(
      await screen.findByText("Approved by Chief Exec"),
    ).toBeInTheDocument();
  });
});

describe("CEOJobOfferDetailPage decisions that need a reason", () => {
  it("refuses to reject without one, then sends reason and recommendation", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    rejectJobOffer.mockResolvedValue(
      ok(
        makeJobOffer({ approval_status: "rejected", workflow: makeWorkflow() }),
      ),
    );

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(screen.getByLabelText("Reject: Nora Khalid"));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(
      await screen.findByText("Write a reason before continuing."),
    ).toBeInTheDocument();
    expect(rejectJobOffer).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Package is above the band." },
    });
    fireEvent.change(within(dialog).getByLabelText("Recommendation for HR"), {
      target: { value: "Re-open at 11,000." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(rejectJobOffer).toHaveBeenCalledWith("11", {
        reason: "Package is above the band.",
        recommendation: "Re-open at 11,000.",
      }),
    );
  });

  it("returns the offer to HR with a reason", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    requestJobOfferChanges.mockResolvedValue(
      ok(
        makeJobOffer({
          approval_status: "changes_requested",
          workflow: makeWorkflow(),
        }),
      ),
    );

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(screen.getByLabelText("Request Changes: Nora Khalid"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Add the contract duration." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Request Changes" }),
    );

    await waitFor(() =>
      expect(requestJobOfferChanges).toHaveBeenCalledWith("11", {
        reason: "Add the contract duration.",
        recommendation: "",
      }),
    );
  });
});

describe("CEOJobOfferDetailPage permissions", () => {
  it("offers nothing on an offer already decided elsewhere", async () => {
    getJobOffer.mockResolvedValue(
      ok(
        makeJobOffer({
          approval_status: "approved",
          approval_status_label: "Approved",
          ceo_decision_by_name: "Another Exec",
          ceo_decision_at: "2026-08-02T09:00:00Z",
          workflow: makeWorkflow(),
        }),
      ),
    );

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    expect(
      screen.getByText("This offer is not waiting on you."),
    ).toBeInTheDocument();
    expect(screen.getByText("Approved by Another Exec")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Approve: Nora Khalid"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Edit Commercial Terms/i }),
    ).not.toBeInTheDocument();
  });

  it("reloads when the offer was decided between load and click", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    approveJobOffer.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { message: "Only job offers pending CEO review can be decided." },
      },
    });

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");
    getJobOffer.mockClear();

    fireEvent.click(screen.getByLabelText("Approve: Nora Khalid"));

    await waitFor(() => expect(approveJobOffer).toHaveBeenCalled());
    expect(
      await screen.findByText(
        "Only job offers pending CEO review can be decided.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(getJobOffer).toHaveBeenCalled());
  });
});

describe("CEOJobOfferDetailPage commercial editing", () => {
  it("sends only commercial fields, never the candidate identity or CV", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    updateJobOffer.mockResolvedValue(
      ok(makeJobOffer({ housing_allowance: "2000.00" })),
    );

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(
      screen.getByRole("button", { name: /Edit Commercial Terms/i }),
    );
    await screen.findByDisplayValue("Engineering");

    fireEvent.click(screen.getByRole("button", { name: /Save Terms/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalled());
    const payload = updateJobOffer.mock.calls[0][1];
    const CEO_COMMERCIAL_FIELDS = new Set([
      "department_id",
      "position_id",
      "position_title",
      "classification",
      "department",
      "location",
      "basic_salary",
      "housing_allowance",
      "transportation_allowance",
      "other_allowance",
      "total_salary_package",
      "vacation",
      "tickets",
      "contract_status",
      "contract_type",
      "contract_duration",
      "medical_insurance",
      "offer_date",
      "expiry_date",
    ]);
    // The backend refuses the whole PATCH if a single key falls outside its
    // allow-list, so the form must never widen this set.
    Object.keys(payload).forEach((key) => {
      expect(CEO_COMMERCIAL_FIELDS.has(key), `${key} is not a CEO field`).toBe(
        true,
      );
    });
    expect(payload).not.toHaveProperty("candidate_full_name");
    expect(payload).not.toHaveProperty("cv_file");
  });

  it("offers no candidate identity input in the commercial form", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(
      screen.getByRole("button", { name: /Edit Commercial Terms/i }),
    );
    await screen.findByDisplayValue("Engineering");

    expect(
      screen.queryByLabelText("Candidate Full Name"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Candidate Email")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("surfaces the permission error when the API refuses a field", async () => {
    getJobOffer.mockResolvedValue(ok(pendingOffer));
    updateJobOffer.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 403,
        data: { message: "CEO may edit commercial job-offer fields only." },
      },
    });

    render(<CEOJobOfferDetailPage />);
    await screen.findAllByText("Nora Khalid");

    fireEvent.click(
      screen.getByRole("button", { name: /Edit Commercial Terms/i }),
    );
    await screen.findByDisplayValue("Engineering");
    fireEvent.click(screen.getByRole("button", { name: /Save Terms/i }));

    expect(
      await screen.findByText("CEO may edit commercial job-offer fields only."),
    ).toBeInTheDocument();
  });
});
