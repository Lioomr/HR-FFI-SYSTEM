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
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const listJobOffers = jobOffersApi.listJobOffers as unknown as ReturnType<
  typeof vi.fn
>;
const cancelJobOffer = jobOffersApi.cancelJobOffer as unknown as ReturnType<
  typeof vi.fn
>;

const draftOffer = {
  id: 11,
  company_id: 1,
  candidate_full_name: "Nora Khalid",
  candidate_email: "nora@example.com",
  candidate_phone_number: "+966501234567",
  nationality: "Saudi",
  id_passport_iqama_number: "1234567890",
  position_title: "Site Engineer",
  classification: "Engineering",
  department: "Projects",
  location: "Riyadh",
  basic_salary: "10000.00",
  housing_allowance: "2500.00",
  transportation_allowance: "1000.00",
  other_allowance: "0.00",
  total_salary_package: "13500.00",
  vacation: "30 days",
  tickets: "Annual",
  contract_status: "New",
  contract_type: "Full time",
  contract_duration: "2 years",
  medical_insurance: "Class A",
  offer_date: "2026-08-01",
  expiry_date: "2026-08-20",
  reference_number: "JO-2026-011",
  hr_signer_user_id: 1,
  hr_signer_name: "HR Manager",
  hr_signer_title: "Head of HR",
  status: "draft" as const,
  status_label: "Draft",
  has_response_token: false,
  sent_at: null,
  accepted_at: null,
  rejected_at: null,
  cancelled_at: null,
  rejection_reason: "",
  delivery_metadata: null,
  created_at: "2026-08-01T08:00:00Z",
  updated_at: "2026-08-01T08:00:00Z",
};

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

describe("JobOffersListPage reference-backed offers", () => {
  it("shows the department and position names the backend derived from the ids", async () => {
    listJobOffers.mockResolvedValue({
      status: "success",
      data: {
        items: [
          {
            ...draftOffer,
            hiring_request_id: 7,
            department_id: 3,
            position_id: 8,
            department: "Projects",
            position_title: "Project Engineer",
          },
        ],
        page: 1,
        page_size: 25,
        count: 1,
        total_pages: 1,
      },
    });

    render(<JobOffersListPage />);

    // The list never sees the ids; it renders exactly what came back.
    expect(await screen.findByText("Project Engineer")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });
});
