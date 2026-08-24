import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let searchParams = new URLSearchParams("token=valid-token");
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [searchParams, vi.fn()],
}));

vi.mock("../../services/api/jobOffersApi", () => ({
  getPublicJobOffer: vi.fn(),
  respondToJobOffer: vi.fn(),
}));

import JobOfferResponsePage from "./JobOfferResponsePage";
import * as jobOffersApi from "../../services/api/jobOffersApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getPublicJobOffer = jobOffersApi.getPublicJobOffer as unknown as ReturnType<typeof vi.fn>;
const respondToJobOffer = jobOffersApi.respondToJobOffer as unknown as ReturnType<typeof vi.fn>;

const summary = {
  candidate_full_name: "Nora Khalid",
  position_title: "Site Engineer",
  department: "Projects",
  location: "Riyadh",
  total_salary_package: "13500.00",
  offer_date: "2026-08-01",
  expiry_date: "2026-08-20",
  status: "sent" as const,
  status_label: "Sent",
  can_respond: true,
};

/** Mimics an Axios rejection so the page's status-code branches are exercised. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

beforeEach(() => {
  searchParams = new URLSearchParams("token=valid-token");
  getPublicJobOffer.mockReset();
  respondToJobOffer.mockReset();
  useI18nStore.getState().setLanguage("en");
});

describe("JobOfferResponsePage", () => {
  it("loads and shows the offer for a valid token", async () => {
    getPublicJobOffer.mockResolvedValue({ status: "success", data: summary });

    render(<JobOfferResponsePage />);

    expect(await screen.findByText("Your Job Offer")).toBeInTheDocument();
    expect(getPublicJobOffer).toHaveBeenCalledWith("valid-token");
    expect(screen.getByText("Hello Nora Khalid")).toBeInTheDocument();
    expect(screen.getByText("Site Engineer")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("13,500")).toBeInTheDocument();
    expect(screen.getByText("2026-08-20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Offer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Offer" })).toBeInTheDocument();
  });

  it("never renders the app sidebar or navigation", async () => {
    getPublicJobOffer.mockResolvedValue({ status: "success", data: summary });

    render(<JobOfferResponsePage />);
    await screen.findByText("Your Job Offer");

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("posts an accepted decision and reports the pending invitation", async () => {
    getPublicJobOffer.mockResolvedValue({ status: "success", data: summary });
    respondToJobOffer.mockResolvedValue({
      status: "success",
      data: {
        status: "accepted",
        status_label: "Accepted",
        invitation: { created: true, channel: "whatsapp", delivery: { sent: true } },
      },
    });

    render(<JobOfferResponsePage />);
    await screen.findByText("Your Job Offer");

    fireEvent.click(screen.getByRole("button", { name: "Accept Offer" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, accept" }));

    await waitFor(() =>
      expect(respondToJobOffer).toHaveBeenCalledWith({ token: "valid-token", decision: "accepted" }),
    );
    expect(await screen.findByText("Offer accepted")).toBeInTheDocument();
    expect(screen.getByText("Your account invitation has been sent.")).toBeInTheDocument();
  });

  it("requires a reason before posting a rejected decision", async () => {
    getPublicJobOffer.mockResolvedValue({ status: "success", data: summary });
    respondToJobOffer.mockResolvedValue({
      status: "success",
      data: { status: "rejected", status_label: "Rejected" },
    });

    render(<JobOfferResponsePage />);
    await screen.findByText("Your Job Offer");

    fireEvent.click(screen.getByRole("button", { name: "Reject Offer" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Rejection" }));
    expect(await screen.findByText("Please provide a reason before submitting.")).toBeInTheDocument();
    expect(respondToJobOffer).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Accepted another role" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Rejection" }));

    await waitFor(() =>
      expect(respondToJobOffer).toHaveBeenCalledWith({
        token: "valid-token",
        decision: "rejected",
        reason: "Accepted another role",
      }),
    );
    expect(await screen.findByText("Offer declined")).toBeInTheDocument();
  });

  it("shows the invalid/expired state for a 422 token", async () => {
    getPublicJobOffer.mockRejectedValue(httpError(422));

    render(<JobOfferResponsePage />);

    expect(await screen.findByText("This link is no longer valid")).toBeInTheDocument();
  });

  it("shows the already-answered state for a 409 response", async () => {
    getPublicJobOffer.mockRejectedValue(httpError(409));

    render(<JobOfferResponsePage />);

    expect(await screen.findByText("This offer has already been answered")).toBeInTheDocument();
  });

  it("switches to the already-answered state when a second submit conflicts", async () => {
    getPublicJobOffer.mockResolvedValue({ status: "success", data: summary });
    respondToJobOffer.mockRejectedValue(httpError(409));

    render(<JobOfferResponsePage />);
    await screen.findByText("Your Job Offer");

    fireEvent.click(screen.getByRole("button", { name: "Accept Offer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, accept" }));

    expect(await screen.findByText("This offer has already been answered")).toBeInTheDocument();
  });

  it("explains a link that carries no token without calling the API", async () => {
    searchParams = new URLSearchParams("");

    render(<JobOfferResponsePage />);

    expect(await screen.findByText("This link is missing its offer reference.")).toBeInTheDocument();
    expect(getPublicJobOffer).not.toHaveBeenCalled();
  });
});

describe("JobOfferResponsePage acceptance follow-up", () => {
  /** Drives the accept flow through to the outcome panel. */
  async function accept(data: Record<string, unknown>) {
    getPublicJobOffer.mockResolvedValue({ status: "success", data: summary });
    respondToJobOffer.mockResolvedValue({ status: "success", data });

    render(<JobOfferResponsePage />);
    await screen.findByText("Your Job Offer");

    fireEvent.click(screen.getByRole("button", { name: "Accept Offer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, accept" }));

    await screen.findByText("Offer accepted");
  }

  const accepted = {
    status: "accepted",
    status_label: "Accepted",
    employee_profile_id: 205,
    invitation: {
      created: true,
      channel: "whatsapp",
      delivery: {
        sent: true,
        provider: "evolution_whatsapp",
        status_code: 201,
        message_id: "message-id",
        error: null,
        attempted_at: "2026-08-23T10:00:00Z",
      },
    },
    biotime: { is_mapped: false, biotime_emp_code: null, mapping_id: null },
  };

  it("confirms the onboarding record once a profile comes back", async () => {
    await accept(accepted);

    expect(
      screen.getByText("Your onboarding record is ready. Our HR team will take it from here."),
    ).toBeInTheDocument();
  });

  it("states the remaining attendance setup neutrally when BioTime is unmapped", async () => {
    await accept(accepted);

    expect(
      screen.getByText("Your onboarding is accepted. HR will complete device attendance setup."),
    ).toBeInTheDocument();
  });

  it("says nothing about attendance once BioTime is mapped", async () => {
    await accept({
      ...accepted,
      biotime: { is_mapped: true, biotime_emp_code: "100001", mapping_id: 7 },
    });

    expect(
      screen.queryByText("Your onboarding is accepted. HR will complete device attendance setup."),
    ).not.toBeInTheDocument();
    // An internal device code is never shown to the candidate either.
    expect(document.body.textContent).not.toContain("100001");
  });

  it("never leaks the delivery provider or internal identifiers", async () => {
    await accept(accepted);

    expect(document.body.textContent).not.toMatch(/evolution/i);
    expect(document.body.textContent).not.toMatch(/bird/i);
    expect(document.body.textContent).not.toContain("message-id");
    expect(document.body.textContent).not.toContain("205");
  });

  it("handles an acceptance that carries neither profile nor biotime", async () => {
    await accept({ status: "accepted", status_label: "Accepted" });

    expect(
      screen.queryByText("Your onboarding record is ready. Our HR team will take it from here."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Your onboarding is accepted. HR will complete device attendance setup."),
    ).not.toBeInTheDocument();
  });
});
