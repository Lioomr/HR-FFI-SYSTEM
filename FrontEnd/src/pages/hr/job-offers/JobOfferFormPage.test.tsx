import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
// Mutable so each test can place itself on the create-from-request path, the
// edit path, or the unsupported blank-create path.
let routeParams: Record<string, string> = {};
let queryString = "";
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => routeParams,
  useSearchParams: () => [new URLSearchParams(queryString), vi.fn()],
}));

vi.mock("../../../services/api/jobOffersApi", () => ({
  createJobOffer: vi.fn(),
  getJobOffer: vi.fn(),
  updateJobOffer: vi.fn(),
}));

vi.mock("../../../services/api/hiringRequestsApi", () => ({
  getHiringRequest: vi.fn(),
  downloadHiringRequestCv: vi.fn(),
}));

vi.mock("../../../services/api/employeesApi", () => ({ listEmployees: vi.fn() }));
vi.mock("../../../services/api/downloads", () => ({ triggerBlobDownload: vi.fn() }));
vi.mock("../../../services/api/departmentsApi", () => ({ listDepartments: vi.fn() }));
vi.mock("../../../services/api/positionsApi", () => ({ listPositions: vi.fn() }));

import JobOfferFormPage from "./JobOfferFormPage";
import { calculateTotalPackage } from "./jobOfferRules";
import * as jobOffersApi from "../../../services/api/jobOffersApi";
import * as hiringRequestsApi from "../../../services/api/hiringRequestsApi";
import * as employeesApi from "../../../services/api/employeesApi";
import * as departmentsApi from "../../../services/api/departmentsApi";
import * as positionsApi from "../../../services/api/positionsApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";
import { makeHiringRequest, ok } from "../hiring-requests/testFixtures";

const createJobOffer = jobOffersApi.createJobOffer as unknown as ReturnType<typeof vi.fn>;
const updateJobOffer = jobOffersApi.updateJobOffer as unknown as ReturnType<typeof vi.fn>;
const getJobOffer = jobOffersApi.getJobOffer as unknown as ReturnType<typeof vi.fn>;
const getHiringRequest = hiringRequestsApi.getHiringRequest as unknown as ReturnType<typeof vi.fn>;
const listEmployees = employeesApi.listEmployees as unknown as ReturnType<typeof vi.fn>;
const listDepartments = departmentsApi.listDepartments as unknown as ReturnType<typeof vi.fn>;
const listPositions = positionsApi.listPositions as unknown as ReturnType<typeof vi.fn>;

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Opens an Ant Select by its label and clicks the named option. */
async function chooseOption(label: string, option: string) {
  const select = screen.getByLabelText(label);
  fireEvent.mouseDown(select);
  await screen.findByTitle(option);
  fireEvent.click(document.querySelector(`.ant-select-item-option[title="${option}"]`)!);
}

const DEPARTMENTS = [
  { id: 3, name: "Projects", code: "PRJ" },
  { id: 4, name: "Finance", code: "FIN" },
];
const POSITIONS = [
  { id: 8, name: "Project Engineer", code: "PE" },
  { id: 9, name: "Accountant", code: "ACC" },
];

const approvedRequest = () =>
  makeHiringRequest({
    id: 7,
    status: "approved",
    proposed_salary: "12000.00",
    ceo_decision_at: "2026-08-05T10:00:00Z",
    ceo_decision_by_name: "Chief Exec",
  });

/** A draft offer, the only state the backend lets HR edit. */
const draftOffer = {
  id: 11,
  company_id: 1,
  employee_profile_id: null,
  candidate_full_name: "Nora Khalid",
  candidate_email: "nora@example.com",
  candidate_phone_number: "+966501234567",
  nationality: "Saudi Arabia",
  id_passport_iqama_number: "1234567890",
  department_id: null,
  position_id: null,
  position_title: "Site Engineer",
  classification: "",
  department: "",
  location: "",
  basic_salary: "10000.00",
  housing_allowance: "0.00",
  transportation_allowance: "0.00",
  other_allowance: "0.00",
  total_salary_package: "10000.00",
  vacation: "",
  tickets: "",
  contract_status: "",
  contract_type: "",
  contract_duration: "",
  medical_insurance: "",
  offer_date: "2026-08-01",
  expiry_date: "2026-08-20",
  reference_number: "JO-2026-011",
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

beforeEach(() => {
  routeParams = {};
  queryString = "";
  navigateMock.mockClear();
  createJobOffer.mockReset();
  updateJobOffer.mockReset();
  getJobOffer.mockReset();
  getHiringRequest.mockReset();
  listEmployees.mockReset().mockResolvedValue({
    status: "success",
    data: { results: [], count: 0 },
  });
  listDepartments.mockReset().mockResolvedValue({ status: "success", data: DEPARTMENTS });
  listPositions.mockReset().mockResolvedValue({ status: "success", data: POSITIONS });
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("calculateTotalPackage", () => {
  it("adds every salary component", () => {
    expect(
      calculateTotalPackage({
        basic_salary: 10000,
        housing_allowance: 2500,
        transportation_allowance: 1000,
        other_allowance: 500,
      }),
    ).toBe(14000);
  });

  it("treats missing and unparsable components as zero", () => {
    expect(calculateTotalPackage({ basic_salary: 8000 })).toBe(8000);
    expect(calculateTotalPackage({ basic_salary: "7500.50", housing_allowance: null })).toBe(7500.5);
    expect(calculateTotalPackage({ basic_salary: "abc" })).toBe(0);
  });
});

describe("JobOfferFormPage — creating from an approved hiring request", () => {
  beforeEach(() => {
    queryString = "hiring_request_id=7";
    getHiringRequest.mockResolvedValue(ok(approvedRequest()));
  });

  it("shows the approved request as the source of the offer", async () => {
    render(<JobOfferFormPage />);

    expect(await screen.findByText("Approved Hiring Request")).toBeInTheDocument();
    expect(getHiringRequest).toHaveBeenCalledWith("7");
    expect(screen.getByText("Approved by Chief Exec")).toBeInTheDocument();
    expect(screen.getAllByText("Nora Khalid").length).toBeGreaterThan(0);
  });

  it("does not offer the candidate fields the backend overwrites", async () => {
    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    expect(screen.queryByLabelText("Candidate Full Name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Candidate Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Candidate Phone Number")).not.toBeInTheDocument();
    // Salary is re-copied too, so it stays visible but locked.
    expect(screen.getByLabelText("Basic Salary")).toBeDisabled();
  });

  it("does not offer an employee profile search, because the backend creates one", async () => {
    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    expect(screen.queryByLabelText("Linked Employee Profile")).not.toBeInTheDocument();
    expect(listEmployees).not.toHaveBeenCalled();
    expect(screen.getByText("Employee profile handled automatically")).toBeInTheDocument();
  });

  it("loads the company's department and position reference data", async () => {
    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await waitFor(() => expect(listDepartments).toHaveBeenCalledTimes(1));
    expect(listPositions).toHaveBeenCalledTimes(1);
    // Free text is gone: both are chosen from the reference records.
    expect(screen.queryByLabelText("Position Title")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Position")).toBeInTheDocument();
    expect(screen.getByLabelText("Department")).toBeInTheDocument();
    expect(screen.getAllByText("Chosen from your company's HR reference data.").length).toBe(2);
  });

  it("sends hiring_request_id with the chosen department and position ids", async () => {
    createJobOffer.mockResolvedValue(ok({ id: 42 }));

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await chooseOption("Position", "Project Engineer");
    await chooseOption("Department", "Projects");

    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    await waitFor(() => expect(createJobOffer).toHaveBeenCalledTimes(1));
    const payload = createJobOffer.mock.calls[0][0];
    expect(payload).toMatchObject({
      hiring_request_id: 7,
      department_id: 3,
      position_id: 8,
      // The offer's own terms still travel with it.
      classification: "",
      location: "",
      offer_date: expect.any(String),
    });
    expect(payload.expiry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/hr/job-offers/42"));
  });

  it("leaves the derived department and position text to the backend", async () => {
    createJobOffer.mockResolvedValue(ok({ id: 42 }));

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await chooseOption("Position", "Project Engineer");
    await chooseOption("Department", "Projects");
    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    await waitFor(() => expect(createJobOffer).toHaveBeenCalledTimes(1));
    const payload = createJobOffer.mock.calls[0][0];
    // The reference ids are the only source of truth; a client-side copy of the
    // names could only ever drift from what the backend writes.
    expect(payload).not.toHaveProperty("department");
    expect(payload).not.toHaveProperty("position_title");
  });

  it("never sends employee_profile_id, which the backend ignores here", async () => {
    createJobOffer.mockResolvedValue(ok({ id: 42 }));

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await chooseOption("Position", "Project Engineer");
    await chooseOption("Department", "Projects");
    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    await waitFor(() => expect(createJobOffer).toHaveBeenCalledTimes(1));
    expect(createJobOffer.mock.calls[0][0]).not.toHaveProperty("employee_profile_id");
  });

  it("refuses to save until a department and a position are chosen", async () => {
    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    expect(await screen.findByText("Select a position.")).toBeInTheDocument();
    expect(screen.getByText("Select a department.")).toBeInTheDocument();
    expect(createJobOffer).not.toHaveBeenCalled();
  });

  it("shows the backend's reference errors on the fields they belong to", async () => {
    createJobOffer.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: 'Invalid pk "999" - object does not exist.',
          errors: [
            { field: "department_id", message: 'Invalid pk "999" - object does not exist.' },
            { field: "position_id", message: "This field is required for hiring-request job offers." },
          ],
        },
      },
    });

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await chooseOption("Position", "Project Engineer");
    await chooseOption("Department", "Projects");
    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    // Both land on their own field, not just in the page-level alert.
    expect(
      await screen.findByText("This field is required for hiring-request job offers."),
    ).toHaveClass("ant-form-item-explain-error");
    const departmentErrors = await screen.findAllByText(
      'Invalid pk "999" - object does not exist.',
    );
    expect(
      departmentErrors.some((node) => node.classList.contains("ant-form-item-explain-error")),
    ).toBe(true);
  });

  it("tells HR to seed reference data when the company has none", async () => {
    listDepartments.mockResolvedValue({ status: "success", data: [] });
    listPositions.mockResolvedValue({ status: "success", data: [] });

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    expect(await screen.findByText("HR reference data is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Draft/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Manage Departments" }));
    expect(navigateMock).toHaveBeenCalledWith("/hr/departments");
  });

  it("names only the missing reference list when just one is empty", async () => {
    listDepartments.mockResolvedValue({ status: "success", data: DEPARTMENTS });
    listPositions.mockResolvedValue({ status: "success", data: [] });

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    expect(await screen.findByText("HR reference data is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage Positions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage Departments" })).not.toBeInTheDocument();
  });

  it("refuses a request the CEO has not approved", async () => {
    getHiringRequest.mockResolvedValue(ok(makeHiringRequest({ id: 7, status: "submitted" })));

    render(<JobOfferFormPage />);

    expect(
      await screen.findByText("This hiring request is not approved, so it cannot become a job offer."),
    ).toBeInTheDocument();
  });
});

describe("JobOfferFormPage — without a source request", () => {
  it("sends HR to the hiring requests instead of a blank offer", async () => {
    render(<JobOfferFormPage />);

    expect(await screen.findByText("Start from an approved hiring request")).toBeInTheDocument();
    expect(screen.queryByLabelText("Position Title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Go to Hiring Requests/i }));
    expect(navigateMock).toHaveBeenCalledWith("/hr/hiring-requests");
  });
});

describe("JobOfferFormPage — editing a legacy draft with no linked request", () => {
  beforeEach(() => {
    routeParams = { id: "11" };
    getJobOffer.mockResolvedValue(ok(draftOffer));
  });

  it("keeps the candidate fields editable, because nothing else owns them", async () => {
    render(<JobOfferFormPage />);

    await waitFor(() =>
      expect(screen.getByLabelText("Candidate Full Name")).toHaveValue("Nora Khalid"),
    );
    expect(screen.getByLabelText("Basic Salary")).not.toBeDisabled();
  });

  it("still writes department and position as the free text they always were", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await waitFor(() => expect(screen.getByLabelText("Position Title")).toBeInTheDocument());

    // No reference lookup happens at all on an offer nothing else owns.
    expect(listDepartments).not.toHaveBeenCalled();
    expect(listPositions).not.toHaveBeenCalled();

    typeInto("Position Title", "Site Engineer II");
    typeInto("Department", "Operations");
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    const payload = updateJobOffer.mock.calls[0][1];
    expect(payload).toMatchObject({
      position_title: "Site Engineer II",
      department: "Operations",
    });
    expect(payload).not.toHaveProperty("department_id");
    expect(payload).not.toHaveProperty("position_id");
  });

  it("shows the running total as compensation is entered", async () => {
    render(<JobOfferFormPage />);
    await waitFor(() => expect(screen.getByLabelText("Basic Salary")).toBeInTheDocument());

    typeInto("Basic Salary", "10000");
    typeInto("Housing Allowance", "2500");
    typeInto("Transportation Allowance", "1000");

    await waitFor(() => expect(screen.getByText("13,500")).toBeInTheDocument());
  });

  it("sends the phone number in E.164 form built from the country picker", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await waitFor(() => expect(screen.getByLabelText("Candidate Phone Number")).toBeInTheDocument());

    typeInto("Candidate Phone Number", "501234567");
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    expect(updateJobOffer.mock.calls[0][1].candidate_phone_number).toBe("+966501234567");
  });

  it("drops the national trunk zero so the number stays reachable", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await waitFor(() => expect(screen.getByLabelText("Candidate Phone Number")).toBeInTheDocument());

    typeInto("Candidate Phone Number", "050 123-4567");
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    expect(updateJobOffer.mock.calls[0][1].candidate_phone_number).toBe("+966501234567");
  });

  it("submits the nationality chosen from the country list", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await waitFor(() => expect(screen.getByLabelText("Nationality")).toBeInTheDocument());

    const nationality = screen.getByLabelText("Nationality");
    fireEvent.mouseDown(nationality);
    fireEvent.change(nationality, { target: { value: "Philip" } });
    await screen.findByTitle("Philippines");
    fireEvent.click(document.querySelector('.ant-select-item-option[title="Philippines"]')!);

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    expect(updateJobOffer.mock.calls[0][1].nationality).toBe("Philippines");
  });

  it("refuses to save without a candidate email or phone number", async () => {
    render(<JobOfferFormPage />);
    await waitFor(() => expect(screen.getByLabelText("Candidate Email")).toBeInTheDocument());

    typeInto("Candidate Email", "");
    typeInto("Candidate Phone Number", "");

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(await screen.findAllByText("Enter a candidate email or phone number.")).not.toHaveLength(0);
    expect(updateJobOffer).not.toHaveBeenCalled();
  });
});

describe("JobOfferFormPage — editing a draft linked to a hiring request", () => {
  /** The same draft, but converted from an approved request. */
  const linkedOffer = {
    ...draftOffer,
    hiring_request_id: 7,
    hiring_request_reference: "HR-2026-001",
    hiring_request_status: "converted" as const,
    department_id: 3,
    position_id: 8,
    department: "Projects",
    position_title: "Project Engineer",
  };

  beforeEach(() => {
    routeParams = { id: "11" };
    getJobOffer.mockResolvedValue(ok(linkedOffer));
    getHiringRequest.mockResolvedValue(ok(approvedRequest()));
  });

  it("shows the source request instead of editable candidate inputs", async () => {
    render(<JobOfferFormPage />);

    expect(await screen.findByText("Approved Hiring Request")).toBeInTheDocument();
    expect(getHiringRequest).toHaveBeenCalledWith(7);

    expect(screen.queryByLabelText("Candidate Full Name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Candidate Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Candidate Phone Number")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nationality")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Linked Employee Profile")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Basic Salary")).toBeDisabled();
  });

  it("preselects the department and position the offer already references", async () => {
    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await waitFor(() => expect(listDepartments).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Position")).toBeInTheDocument();
    expect(screen.getByTitle("Project Engineer")).toBeInTheDocument();
    expect(screen.getByTitle("Projects")).toBeInTheDocument();
  });

  it("leaves every source-controlled field out of the PATCH", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    const payload = updateJobOffer.mock.calls[0][1];
    [
      "candidate_full_name",
      "candidate_email",
      "candidate_phone_number",
      "nationality",
      "basic_salary",
      "company",
      "company_id",
      "hiring_request_id",
      // The backend rejects this one on a linked PATCH as well.
      "employee_profile_id",
    ].forEach((field) => {
      expect(payload, `${field} must not be sent`).not.toHaveProperty(field);
    });
  });

  it("still saves the offer terms that are the offer's own", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    await waitFor(() => expect(listPositions).toHaveBeenCalledTimes(1));
    await chooseOption("Position", "Accountant");
    await chooseOption("Department", "Finance");
    typeInto("Housing Allowance", "2500");
    typeInto("Contract Type", "Full time");

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    const payload = updateJobOffer.mock.calls[0][1];
    expect(payload).toMatchObject({
      position_id: 9,
      department_id: 4,
      housing_allowance: "2500",
      contract_type: "Full time",
    });
    // Same rule as on create: the names are the backend's to derive.
    expect(payload).not.toHaveProperty("department");
    expect(payload).not.toHaveProperty("position_title");
  });

  it("keeps the package total derived from the read-only basic salary", async () => {
    updateJobOffer.mockResolvedValue(ok({ id: 11 }));

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    typeInto("Housing Allowance", "2500");

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalledTimes(1));
    // 10,000 basic (from the offer) + 2,500 housing, even though basic is not sent.
    expect(updateJobOffer.mock.calls[0][1].total_salary_package).toBe("12500");
  });

  it("surfaces the backend's source-controlled 422 rather than failing silently", async () => {
    const message = "This field is controlled by the linked hiring request and cannot be edited.";
    updateJobOffer.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message,
          errors: [{ field: "candidate_full_name", message }],
        },
      },
    });

    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("offers the CV of the linked request", async () => {
    render(<JobOfferFormPage />);
    await screen.findByText("Approved Hiring Request");

    expect(screen.getByRole("button", { name: /Download CV/i })).toBeInTheDocument();
  });
});
