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

vi.mock("../../../services/api/jobOffersApi", () => ({
  getJobOffer: vi.fn(),
  sendJobOffer: vi.fn(),
  cancelJobOffer: vi.fn(),
  downloadJobOfferPdf: vi.fn(),
}));

vi.mock("../../../services/api/downloads", () => ({
  triggerBlobDownload: vi.fn(),
}));

vi.mock("../../../services/api/employeesApi", () => ({
  getEmployeeDocuments: vi.fn(),
  downloadEmployeeDocument: vi.fn(),
}));

import JobOfferDetailPage from "./JobOfferDetailPage";
import * as jobOffersApi from "../../../services/api/jobOffersApi";
import * as downloads from "../../../services/api/downloads";
import * as employeesApi from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const getJobOffer = jobOffersApi.getJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const sendJobOffer = jobOffersApi.sendJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const downloadJobOfferPdf =
  jobOffersApi.downloadJobOfferPdf as unknown as ReturnType<typeof vi.fn>;
const triggerBlobDownload =
  downloads.triggerBlobDownload as unknown as ReturnType<typeof vi.fn>;
const getEmployeeDocuments =
  employeesApi.getEmployeeDocuments as unknown as ReturnType<typeof vi.fn>;
const downloadEmployeeDocument =
  employeesApi.downloadEmployeeDocument as unknown as ReturnType<typeof vi.fn>;

const draftOffer = {
  id: 11,
  company_id: 1,
  employee_profile_id: null,
  account_invite_id: null,
  candidate_full_name: "Nora Khalid",
  candidate_email: "nora@example.com",
  candidate_phone_number: "+966501234567",
  nationality: "Saudi",
  id_passport_iqama_number: "1234567890",
  department_id: null,
  position_id: null,
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
  biotime: { is_mapped: false, biotime_emp_code: null, mapping_id: null },
  sent_at: null,
  accepted_at: null,
  rejected_at: null,
  cancelled_at: null,
  rejection_reason: "",
  delivery_metadata: null,
  created_at: "2026-08-01T08:00:00Z",
  updated_at: "2026-08-01T08:00:00Z",
};

const sentOfferWithWarning = {
  ...draftOffer,
  status: "sent" as const,
  status_label: "Sent",
  has_response_token: true,
  sent_at: "2026-08-02T09:00:00Z",
  delivery_metadata: {
    channels: {
      whatsapp: {
        sent: false,
        provider: "evolution_whatsapp",
        error: "Delivery failed.",
      },
      email: { sent: true, provider: "bird", attachment: "attached" as const },
    },
    warnings: ["WhatsApp delivery failed."],
  },
};

beforeEach(() => {
  navigateMock.mockClear();
  getJobOffer.mockReset();
  sendJobOffer.mockReset();
  downloadJobOfferPdf.mockReset();
  triggerBlobDownload.mockReset();
  getEmployeeDocuments.mockReset().mockResolvedValue({ status: "success", data: [] });
  downloadEmployeeDocument.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("JobOfferDetailPage", () => {
  it("renders the offer summary and its compensation package", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: draftOffer });

    render(<JobOfferDetailPage />);

    expect(await screen.findByText("Nora Khalid")).toBeInTheDocument();
    expect(screen.getByText("13,500")).toBeInTheDocument();
    expect(
      screen.getByText("This offer has not been sent yet."),
    ).toBeInTheDocument();
  });

  it("sends the offer after confirmation and surfaces the delivery warning", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: draftOffer });
    sendJobOffer.mockResolvedValue({
      status: "success",
      data: {
        offer: sentOfferWithWarning,
        delivery: sentOfferWithWarning.delivery_metadata,
      },
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByRole("button", { name: /Send Offer/i }));

    const dialog = await screen.findByRole("dialog");
    expect(sendJobOffer).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send Offer" }));

    await waitFor(() => expect(sendJobOffer).toHaveBeenCalledWith("11"));

    // The offer went out even though WhatsApp failed: the page shows the
    // warning rather than treating the send as a failure.
    expect(await screen.findByText("Delivery warnings")).toBeInTheDocument();
    expect(
      screen.getByText("The WhatsApp message could not be delivered."),
    ).toBeInTheDocument();
    expect(screen.getByText("Not delivered")).toBeInTheDocument();
    expect(
      screen.getByText("Handed to the delivery service"),
    ).toBeInTheDocument();
  });

  it("never names the delivery provider", async () => {
    getJobOffer.mockResolvedValue({
      status: "success",
      data: sentOfferWithWarning,
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(document.body.textContent).not.toMatch(/bird/i);
    expect(document.body.textContent).not.toMatch(/evolution/i);
  });

  it("downloads the offer PDF under a predictable filename", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: draftOffer });
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    downloadJobOfferPdf.mockResolvedValue(blob);

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    await waitFor(() => expect(downloadJobOfferPdf).toHaveBeenCalledWith("11"));
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, "job_offer_11.pdf");
  });

  it("hides send and cancel once the offer is accepted", async () => {
    getJobOffer.mockResolvedValue({
      status: "success",
      data: {
        ...sentOfferWithWarning,
        status: "accepted",
        status_label: "Accepted",
        accepted_at: "2026-08-03T10:00:00Z",
        account_invite_id: 7,
      },
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(
      screen.queryByRole("button", { name: /Send Offer/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Cancel Offer/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Offer accepted")).toBeInTheDocument();
    expect(screen.getByText("System invitation sent")).toBeInTheDocument();
  });
});

/**
 * The per-leg shape the backend now returns: the candidate's text plus PDF
 * copies, and a PDF copy to every CEO recipient.
 */
const sentOfferWithLegs = {
  ...draftOffer,
  status: "sent" as const,
  status_label: "Sent",
  has_response_token: true,
  sent_at: "2026-08-02T09:00:00Z",
  hiring_request_id: 7,
  hiring_request_reference: "HR-2026-001",
  delivery_metadata: {
    channels: {
      whatsapp: { sent: true, provider: "evolution_whatsapp" },
      email: { sent: true, provider: "bird", attachment: "attached" as const },
    },
    candidate: {
      text: { sent: true, provider: "evolution_whatsapp" },
      whatsapp_pdf: {
        sent: false,
        skipped: true,
        provider: "evolution_whatsapp",
        error: "Candidate phone number is missing.",
      },
      email_pdf: { sent: true, provider: "bird", attachment: "attached" as const },
    },
    ceo: {
      recipients: [
        {
          user_id: 9,
          display_name: "Chief Exec",
          whatsapp_pdf: { sent: true, provider: "evolution_whatsapp" },
          email_pdf: { sent: false, provider: "bird", error: "Delivery failed." },
        },
      ],
    },
    warning_details: { ceo_email_pdf: ["CEO email PDF delivery failed for user 9."] },
    warnings: ["CEO email PDF delivery failed for user 9."],
  },
};

describe("JobOfferDetailPage delivery breakdown", () => {
  it("shows each candidate and CEO delivery leg", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: sentOfferWithLegs });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("Candidate")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp message")).toBeInTheDocument();
    expect(screen.getAllByText("WhatsApp PDF").length).toBe(2);
    expect(screen.getAllByText("Email PDF").length).toBe(2);
    expect(screen.getByText("CEO copies")).toBeInTheDocument();
    expect(screen.getByText("Chief Exec")).toBeInTheDocument();
  });

  it("separates a skipped leg from a failed one", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: sentOfferWithLegs });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    // Candidate WhatsApp PDF was never attempted; the CEO email PDF failed.
    expect(screen.getByText("Not attempted")).toBeInTheDocument();
    expect(screen.getByText("Not delivered")).toBeInTheDocument();
    expect(screen.getAllByText("Handed to the delivery service").length).toBe(3);
  });

  it("names no delivery provider anywhere on the page", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: sentOfferWithLegs });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(document.body.textContent).not.toMatch(/bird/i);
    expect(document.body.textContent).not.toMatch(/evolution/i);
  });

  it("still renders a legacy offer that only carries the old channels shape", async () => {
    // Offers sent before delivery was split per leg have no `candidate` block.
    getJobOffer.mockResolvedValue({ status: "success", data: sentOfferWithWarning });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("WhatsApp message")).toBeInTheDocument();
    expect(screen.getByText("Email PDF")).toBeInTheDocument();
    expect(screen.getByText("Not delivered")).toBeInTheDocument();
    expect(screen.getByText("Handed to the delivery service")).toBeInTheDocument();
  });
});

describe("JobOfferDetailPage starting work acknowledgment", () => {
  /** An accepted offer whose candidate now has an employee profile. */
  const acceptedOffer = {
    ...draftOffer,
    status: "accepted" as const,
    status_label: "Accepted",
    employee_profile_id: 21,
    accepted_at: "2026-08-03T10:00:00Z",
  };

  const acknowledgmentDocument = {
    id: 55,
    employee_profile_id: 21,
    document_type: "OTHER",
    custom_name: "Starting Work Acknowledgment",
    display_name: "Starting Work Acknowledgment",
    original_filename: "starting-work-acknowledgment-EMP-1-20260810.pdf",
    extraction_status: "success",
    extracted_fields: { ocr: "skipped", generated_by_system: true },
    created_at: "2026-08-10T08:00:00Z",
    updated_at: "2026-08-10T08:00:00Z",
  };

  it("reads the acknowledgment from the linked employee's archive", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: acceptedOffer });
    getEmployeeDocuments.mockResolvedValue({
      status: "success",
      data: [acknowledgmentDocument],
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    await waitFor(() => expect(getEmployeeDocuments).toHaveBeenCalledWith(21));
    expect(await screen.findByText("Generated")).toBeInTheDocument();
    expect(screen.getByText("Starting Work Acknowledgment")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Download acknowledgment/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open document archive/i })).toBeInTheDocument();
  });

  it("downloads it through the existing employee document endpoint", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: acceptedOffer });
    getEmployeeDocuments.mockResolvedValue({
      status: "success",
      data: [acknowledgmentDocument],
    });
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    downloadEmployeeDocument.mockResolvedValue(blob);

    render(<JobOfferDetailPage />);
    await screen.findByText("Generated");

    fireEvent.click(screen.getByRole("button", { name: /Download acknowledgment/i }));

    await waitFor(() => expect(downloadEmployeeDocument).toHaveBeenCalledWith(21, 55));
    expect(triggerBlobDownload).toHaveBeenCalledWith(
      blob,
      "starting-work-acknowledgment-EMP-1-20260810.pdf",
    );
  });

  it("opens the employee's document archive", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: acceptedOffer });
    getEmployeeDocuments.mockResolvedValue({
      status: "success",
      data: [acknowledgmentDocument],
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Generated");

    fireEvent.click(screen.getByRole("button", { name: /Open document archive/i }));

    expect(navigateMock).toHaveBeenCalledWith("/hr/employees/21");
  });

  it("waits on BioTime attendance while the archive has no acknowledgment", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: acceptedOffer });
    getEmployeeDocuments.mockResolvedValue({
      status: "success",
      data: [{ ...acknowledgmentDocument, custom_name: "Contract", display_name: "Contract" }],
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(await screen.findByText("Pending BioTime attendance")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This document will be generated after the employee's first BioTime attendance record.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Download acknowledgment/i }),
    ).not.toBeInTheDocument();
  });

  it("stays pending, and asks for nothing, when no employee profile is linked", async () => {
    getJobOffer.mockResolvedValue({
      status: "success",
      data: { ...acceptedOffer, employee_profile_id: null },
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("Pending BioTime attendance")).toBeInTheDocument();
    expect(getEmployeeDocuments).not.toHaveBeenCalled();
  });

  it("falls back to pending when the archive cannot be read", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: acceptedOffer });
    getEmployeeDocuments.mockRejectedValue(new Error("network"));

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    // A failed lookup must not take the rest of the offer down with it.
    expect(await screen.findByText("Pending BioTime attendance")).toBeInTheDocument();
    // The position appears in both the header and the job details table.
    expect(screen.getAllByText("Site Engineer").length).toBeGreaterThan(0);
  });
});

describe("JobOfferDetailPage onboarding and BioTime status", () => {
  const linkedOffer = {
    ...draftOffer,
    hiring_request_id: 7,
    department_id: 3,
    position_id: 8,
    status: "accepted" as const,
    status_label: "Accepted",
    employee_profile_id: 205,
    accepted_at: "2026-08-03T10:00:00Z",
  };

  it("renders the department and position names the backend derived", async () => {
    getJobOffer.mockResolvedValue({
      status: "success",
      data: {
        ...linkedOffer,
        // The form never sent these; they came back derived from the ids.
        department: "Projects",
        position_title: "Project Engineer",
      },
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("Projects")).toBeInTheDocument();
    // Header subtitle and the job details row both read from the response.
    expect(screen.getAllByText("Project Engineer").length).toBeGreaterThan(0);
  });

  it("reports the pre-hire profile the backend created", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: linkedOffer });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("Pre-hire profile created")).toBeInTheDocument();
    expect(screen.getByText("Profile #205")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open employee profile" }));
    expect(navigateMock).toHaveBeenCalledWith("/hr/employees/205");
  });

  it("shows the device code once BioTime is mapped", async () => {
    getJobOffer.mockResolvedValue({
      status: "success",
      data: {
        ...linkedOffer,
        biotime: { is_mapped: true, biotime_emp_code: "100001", mapping_id: 7 },
      },
    });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("BioTime connected")).toBeInTheDocument();
    expect(screen.getByText("Device employee code 100001")).toBeInTheDocument();
    expect(screen.queryByText("BioTime mapping not connected yet")).not.toBeInTheDocument();
  });

  it("warns about a missing mapping without implying the acceptance failed", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: linkedOffer });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("BioTime mapping not connected yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "HR has been notified. Attendance records start once the device mapping is added; the candidate's acceptance is unaffected.",
      ),
    ).toBeInTheDocument();
    // The acceptance itself still reads as a success.
    expect(screen.getByText("Offer accepted")).toBeInTheDocument();
  });

  it("treats a response without the biotime block as unmapped rather than crashing", async () => {
    const withoutBioTime: Record<string, unknown> = { ...linkedOffer };
    delete withoutBioTime.biotime;
    getJobOffer.mockResolvedValue({ status: "success", data: withoutBioTime });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("BioTime mapping not connected yet")).toBeInTheDocument();
  });

  it("keeps legacy offers with no profile on the unlinked wording", async () => {
    getJobOffer.mockResolvedValue({ status: "success", data: draftOffer });

    render(<JobOfferDetailPage />);
    await screen.findByText("Nora Khalid");

    expect(screen.getByText("No employee profile is linked to this offer.")).toBeInTheDocument();
    expect(screen.queryByText("Pre-hire profile created")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open employee profile" }),
    ).not.toBeInTheDocument();
  });
});
