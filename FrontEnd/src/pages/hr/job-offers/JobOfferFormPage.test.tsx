import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
// Mutable so each test can place itself on the create path or the edit path.
let routeParams: Record<string, string> = {};
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => routeParams,
}));

vi.mock("../../../services/api/jobOffersApi", async (importOriginal) => {
  // The CV constants are real: the picker and the size check read them.
  const actual =
    await importOriginal<typeof import("../../../services/api/jobOffersApi")>();
  return {
    ...actual,
    createJobOffer: vi.fn(),
    getJobOffer: vi.fn(),
    updateJobOffer: vi.fn(),
    submitJobOffer: vi.fn(),
  };
});

vi.mock("../../../services/api/departmentsApi", () => ({
  listDepartments: vi.fn(),
}));
vi.mock("../../../services/api/positionsApi", () => ({
  listPositions: vi.fn(),
}));

import JobOfferFormPage from "./JobOfferFormPage";
import * as jobOffersApi from "../../../services/api/jobOffersApi";
import * as departmentsApi from "../../../services/api/departmentsApi";
import * as positionsApi from "../../../services/api/positionsApi";
import { makeJobOffer, makeWorkflow } from "./testFixtures";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const createJobOffer = jobOffersApi.createJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const updateJobOffer = jobOffersApi.updateJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const getJobOffer = jobOffersApi.getJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const submitJobOffer = jobOffersApi.submitJobOffer as unknown as ReturnType<
  typeof vi.fn
>;
const listDepartments = departmentsApi.listDepartments as unknown as ReturnType<
  typeof vi.fn
>;
const listPositions = positionsApi.listPositions as unknown as ReturnType<
  typeof vi.fn
>;

const DEPARTMENTS = [
  { id: 3, name: "Projects", code: "PRJ" },
  { id: 4, name: "Finance", code: "FIN" },
];
const POSITIONS = [
  { id: 8, name: "Project Engineer", code: "PE" },
  { id: 9, name: "Accountant", code: "ACC" },
];

const ok = <T,>(data: T) => ({ status: "success" as const, data });

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Opens an Ant Select by its label and clicks the named option. */
async function chooseOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  await screen.findByTitle(option);
  fireEvent.click(
    document.querySelector(`.ant-select-item-option[title="${option}"]`)!,
  );
}

/** Drops a file on the CV dragger the way the browser would. */
async function attachCv(name: string, size = 1024) {
  const file = new File(["cv"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  routeParams = {};
  navigateMock.mockClear();
  createJobOffer.mockReset();
  updateJobOffer.mockReset();
  getJobOffer.mockReset();
  submitJobOffer.mockReset();
  listDepartments.mockReset().mockResolvedValue(ok(DEPARTMENTS));
  listPositions.mockReset().mockResolvedValue(ok(POSITIONS));
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

/** Fills the fields the backend insists on for a create. */
async function fillRequiredFields() {
  typeInto("Candidate Full Name", "Nora Khalid");
  typeInto("Candidate Email", "nora@example.com");
  await chooseOption("Position", "Project Engineer");
  await chooseOption("Department", "Projects");
}

describe("JobOfferFormPage direct creation", () => {
  it("creates the offer without any hiring request in the way", async () => {
    createJobOffer.mockResolvedValue(ok(makeJobOffer({ id: 31 })));

    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    await fillRequiredFields();
    await attachCv("cv.pdf");
    await waitFor(() => expect(screen.getByText("cv.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    await waitFor(() => expect(createJobOffer).toHaveBeenCalled());
    const payload = createJobOffer.mock.calls[0][0];
    expect(payload.candidate_full_name).toBe("Nora Khalid");
    expect(payload.department_id).toBe(3);
    expect(payload.position_id).toBe(8);
    expect(payload.cv_file).toBeInstanceOf(File);
    // Nothing hiring-request shaped is ever sent.
    expect(payload).not.toHaveProperty("hiring_request_id");
    expect(navigateMock).toHaveBeenCalledWith("/hr/job-offers/31");
  });

  it("refuses to save without a CV, before any request is made", async () => {
    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    expect(
      await screen.findByText(
        "Attach the candidate CV before saving the offer.",
      ),
    ).toBeInTheDocument();
    expect(createJobOffer).not.toHaveBeenCalled();
  });

  it("rejects an unsupported CV type before uploading it", async () => {
    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    await attachCv("cv.exe");

    expect(
      await screen.findByText(
        "The CV must be a PDF, DOC, DOCX, JPG or PNG file.",
      ),
    ).toBeInTheDocument();
  });

  it("rejects a CV over the 5 MB cap before uploading it", async () => {
    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    await attachCv("cv.pdf", 6 * 1024 * 1024);

    expect(
      await screen.findByText("The CV must be 5 MB or smaller."),
    ).toBeInTheDocument();
  });

  /**
   * The negative half of the required-field rule. The positive half — that
   * choosing both records lets the create through with `position_id` and
   * `department_id` — is already asserted by the first test in this block, so
   * this one opens no dropdown and submits once.
   */
  it("blocks creation when no position or department is chosen", async () => {
    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    typeInto("Candidate Full Name", "Nora Khalid");
    typeInto("Candidate Email", "nora@example.com");
    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    // The accessible state rather than the message text: antd marks the
    // combobox itself invalid, which is what a screen reader gets and what
    // survives any rewording of the copy.
    await waitFor(() => {
      expect(screen.getByLabelText("Position")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByLabelText("Department")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(createJobOffer).not.toHaveBeenCalled();
  });
});

describe("JobOfferFormPage submission to the CEO", () => {
  it("saves and then submits in one action", async () => {
    createJobOffer.mockResolvedValue(ok(makeJobOffer({ id: 31 })));
    submitJobOffer.mockResolvedValue(
      ok({
        job_offer: makeJobOffer({ id: 31, approval_status: "pending_ceo" }),
        notifications: [],
      }),
    );

    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    await fillRequiredFields();
    await attachCv("cv.pdf");
    await waitFor(() => expect(screen.getByText("cv.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Submit to CEO/i }));

    await waitFor(() => expect(createJobOffer).toHaveBeenCalled());
    await waitFor(() => expect(submitJobOffer).toHaveBeenCalledWith(31));
    expect(navigateMock).toHaveBeenCalledWith("/hr/job-offers/31");
  });

  it("blocks submission with no CV rather than saving and failing", async () => {
    render(<JobOfferFormPage />);
    await screen.findByLabelText("Candidate Full Name");

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Submit to CEO/i }));

    expect(
      await screen.findByText("Attach a CV before submitting to the CEO."),
    ).toBeInTheDocument();
    expect(createJobOffer).not.toHaveBeenCalled();
    expect(submitJobOffer).not.toHaveBeenCalled();
  });
});

describe("JobOfferFormPage editing", () => {
  it("keeps the stored CV when the edit does not replace it", async () => {
    routeParams = { id: "11" };
    getJobOffer.mockResolvedValue(
      ok(
        makeJobOffer({
          workflow: makeWorkflow({ can_edit: true, can_submit: true }),
        }),
      ),
    );
    updateJobOffer.mockResolvedValue(ok(makeJobOffer()));

    render(<JobOfferFormPage />);
    await screen.findByDisplayValue("Nora Khalid");
    expect(
      screen.getByText(
        "A CV is already attached. Upload another file only to replace it.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalled());
    expect(updateJobOffer.mock.calls[0][1]).not.toHaveProperty("cv_file");
  });

  it("resubmits an offer the CEO returned, showing their reason", async () => {
    routeParams = { id: "11" };
    getJobOffer.mockResolvedValue(
      ok(
        makeJobOffer({
          approval_status: "changes_requested",
          ceo_decision_reason: "Housing allowance is above the band.",
          workflow: makeWorkflow({ can_edit: true, can_submit: true }),
        }),
      ),
    );
    updateJobOffer.mockResolvedValue(ok(makeJobOffer()));
    submitJobOffer.mockResolvedValue(
      ok({ job_offer: makeJobOffer(), notifications: [] }),
    );

    render(<JobOfferFormPage />);
    await screen.findByDisplayValue("Nora Khalid");
    expect(
      screen.getByText("Housing allowance is above the band."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Submit to CEO/i }));

    await waitFor(() => expect(updateJobOffer).toHaveBeenCalled());
    await waitFor(() => expect(submitJobOffer).toHaveBeenCalledWith(11));
  });

  it("locks the form and hides Submit once the backend says it is not editable", async () => {
    routeParams = { id: "11" };
    getJobOffer.mockResolvedValue(
      ok(
        makeJobOffer({
          approval_status: "pending_ceo",
          workflow: makeWorkflow(),
        }),
      ),
    );

    render(<JobOfferFormPage />);
    await screen.findByDisplayValue("Nora Khalid");

    expect(
      screen.getByText(
        "Only drafts and offers the CEO returned for changes can be edited.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Submit to CEO/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a backend validation error on the field it belongs to", async () => {
    routeParams = { id: "11" };
    getJobOffer.mockResolvedValue(
      ok(makeJobOffer({ workflow: makeWorkflow({ can_edit: true }) })),
    );
    updateJobOffer.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          message: "Validation error",
          errors: { expiry_date: ["Expiry date cannot be before offer date."] },
        },
      },
    });

    render(<JobOfferFormPage />);
    await screen.findByDisplayValue("Nora Khalid");

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(
      await screen.findByText("Expiry date cannot be before offer date."),
    ).toBeInTheDocument();
  });
});
