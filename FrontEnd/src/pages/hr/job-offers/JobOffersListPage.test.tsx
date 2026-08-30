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

vi.mock("../../../services/api/jobOffersApi", () => ({
  listJobOffers: vi.fn(),
  sendJobOffer: vi.fn(),
  cancelJobOffer: vi.fn(),
  downloadJobOfferPdf: vi.fn(),
}));

import JobOffersListPage from "./JobOffersListPage";
import * as jobOffersApi from "../../../services/api/jobOffersApi";
import { makeJobOffer, makeWorkflow } from "./testFixtures";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const listJobOffers = jobOffersApi.listJobOffers as unknown as ReturnType<
  typeof vi.fn
>;
const cancelJobOffer = jobOffersApi.cancelJobOffer as unknown as ReturnType<
  typeof vi.fn
>;

const draftOffer = makeJobOffer({
  workflow: makeWorkflow({
    can_edit: true,
    can_submit: true,
    can_cancel: true,
  }),
});

const approvedOffer = makeJobOffer({
  id: 12,
  candidate_full_name: "Omar Saleh",
  approval_status: "approved",
  approval_status_label: "Approved",
  workflow: makeWorkflow({ can_send: true, can_cancel: true }),
});

const ok = (items: unknown[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 25, count: items.length, total_pages: 1 },
});

beforeEach(() => {
  navigateMock.mockClear();
  listJobOffers.mockReset();
  cancelJobOffer.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("JobOffersListPage", () => {
  it("renders offers and every status filter", async () => {
    listJobOffers.mockResolvedValue(ok([draftOffer]));

    render(<JobOffersListPage />);

    expect(await screen.findByText("Nora Khalid")).toBeInTheDocument();
    expect(screen.getByText("Site Engineer")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("13,500")).toBeInTheDocument();

    // "Draft" also appears as the row's status chip, so assert presence rather
    // than uniqueness for the filter labels.
    [
      "All",
      "Draft",
      "Sent",
      "Accepted",
      "Rejected",
      "Expired",
      "Cancelled",
    ].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });

    expect(listJobOffers).toHaveBeenCalledWith({ page: 1, page_size: 25 });
  });

  it("sends the chosen status to the backend", async () => {
    listJobOffers.mockResolvedValue(ok([draftOffer]));

    render(<JobOffersListPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByText("Accepted"));

    await waitFor(() =>
      expect(listJobOffers).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 25,
        status: "accepted",
      }),
    );
  });

  it("shows the unfiltered empty state when there are no offers at all", async () => {
    listJobOffers.mockResolvedValue(ok([]));

    render(<JobOffersListPage />);

    expect(await screen.findByText("No job offers yet")).toBeInTheDocument();
  });

  it("shows the filtered empty state once a filter is applied", async () => {
    listJobOffers.mockResolvedValue(ok([]));

    render(<JobOffersListPage />);
    await screen.findByText("No job offers yet");

    fireEvent.click(screen.getByText("Rejected"));

    expect(
      await screen.findByText("No offers match these filters"),
    ).toBeInTheDocument();
  });

  it("shows the load error instead of a raw TypeError when the response is not an envelope", async () => {
    // What a misrouted request looks like: the SPA shell resolves as the body.
    listJobOffers.mockResolvedValue("<!doctype html><html></html>");

    render(<JobOffersListPage />);

    expect(
      await screen.findByText("Could not load job offers."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Cannot read properties/),
    ).not.toBeInTheDocument();
  });

  it("only cancels after the confirmation is accepted", async () => {
    listJobOffers.mockResolvedValue(ok([draftOffer]));
    cancelJobOffer.mockResolvedValue({
      status: "success" as const,
      data: { ...draftOffer, status: "cancelled", status_label: "Cancelled" },
    });

    render(<JobOffersListPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByLabelText("Cancel Offer: Nora Khalid"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getAllByText("Cancel this job offer?").length,
    ).toBeGreaterThan(0);
    expect(cancelJobOffer).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel Offer" }),
    );

    await waitFor(() => expect(cancelJobOffer).toHaveBeenCalledWith(11));
  });
});

describe("JobOffersListPage CEO approval", () => {
  it("shows the approval status alongside the delivery status", async () => {
    listJobOffers.mockResolvedValue(ok([approvedOffer]));

    render(<JobOffersListPage />);

    expect(await screen.findByText("Omar Saleh")).toBeInTheDocument();
    expect(screen.getAllByText("CEO approved").length).toBeGreaterThan(0);
  });

  it("filters by approval status", async () => {
    listJobOffers.mockResolvedValue(ok([draftOffer]));

    render(<JobOffersListPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByText("Pending CEO"));

    await waitFor(() =>
      expect(listJobOffers).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 25,
        approval_status: "pending_ceo",
      }),
    );
  });

  it("offers Send only on an offer the backend says may be sent", async () => {
    listJobOffers.mockResolvedValue(ok([draftOffer, approvedOffer]));

    render(<JobOffersListPage />);
    await screen.findByText("Nora Khalid");

    // Nora is still a draft awaiting the CEO; Omar has been approved.
    expect(
      screen.queryByLabelText("Send Offer: Nora Khalid"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Send Offer: Omar Saleh")).toBeInTheDocument();
  });

  it("starts a new offer directly instead of routing through a request", async () => {
    listJobOffers.mockResolvedValue(ok([]));

    render(<JobOffersListPage />);
    await screen.findByText("No job offers yet");

    // The header action and the empty state both offer it; either is fine.
    fireEvent.click(screen.getAllByRole("button", { name: /New Offer/i })[0]);

    expect(navigateMock).toHaveBeenCalledWith("/hr/job-offers/new");
  });
});
