import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
}));

vi.mock("../../../services/api/hiringRequestsApi", async (importOriginal) => {
  // The file-type/size constants are real behaviour under test, so only the
  // network functions are replaced.
  const actual = await importOriginal<typeof import("../../../services/api/hiringRequestsApi")>();
  return {
    ...actual,
    createHiringRequest: vi.fn(),
    getHiringRequest: vi.fn(),
    updateHiringRequest: vi.fn(),
    submitHiringRequest: vi.fn(),
  };
});

import HiringRequestFormPage from "./HiringRequestFormPage";
import { isAllowedCvFile } from "./hiringRequestRules";
import * as hiringRequestsApi from "../../../services/api/hiringRequestsApi";
import { MAX_CV_SIZE_BYTES } from "../../../services/api/hiringRequestsApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";
import { makeHiringRequest, ok } from "./testFixtures";

const createHiringRequest = hiringRequestsApi.createHiringRequest as unknown as ReturnType<typeof vi.fn>;
const submitHiringRequest = hiringRequestsApi.submitHiringRequest as unknown as ReturnType<typeof vi.fn>;

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function attachCv(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function pdf(name = "cv.pdf", size = 1024) {
  const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  navigateMock.mockClear();
  createHiringRequest.mockReset();
  submitHiringRequest.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "1",
      email: "hr@ffi.test",
      role: "HRManager",
      active_organization_id: 1,
      accessible_organizations: [
        {
          id: 1,
          code: "FFI",
          name: "FFI",
          node_type: "company",
          parent_id: null,
          is_active: true,
        },
      ],
    },
  });
});

describe("isAllowedCvFile", () => {
  it("accepts every extension the backend allows", () => {
    [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"].forEach((extension) => {
      expect(isAllowedCvFile({ name: `cv${extension}`, size: 10 }).ok).toBe(true);
    });
  });

  it("rejects an extension the backend would refuse", () => {
    expect(isAllowedCvFile({ name: "cv.exe", size: 10 })).toEqual({ ok: false, reason: "type" });
  });

  it("rejects a file over the 5 MB ceiling", () => {
    expect(isAllowedCvFile({ name: "cv.pdf", size: MAX_CV_SIZE_BYTES + 1 })).toEqual({
      ok: false,
      reason: "size",
    });
    expect(isAllowedCvFile({ name: "cv.pdf", size: MAX_CV_SIZE_BYTES }).ok).toBe(true);
  });
});

describe("HiringRequestFormPage", () => {
  it("shows the joining company from the active organization", async () => {
    render(<HiringRequestFormPage />);

    expect(await screen.findByText("Joining Company")).toBeInTheDocument();
    expect(screen.getByText("FFI")).toBeInTheDocument();
  });

  it("saves a draft with the CV attached under cv_file", async () => {
    createHiringRequest.mockResolvedValue(ok(makeHiringRequest({ id: 12 })));
    const file = pdf();

    render(<HiringRequestFormPage />);

    typeInto("Candidate Full Name", "Nora Khalid");
    typeInto("Candidate Email", "nora@example.com");
    typeInto("Proposed Salary", "12000");
    attachCv(file);

    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    await waitFor(() => expect(createHiringRequest).toHaveBeenCalledTimes(1));
    expect(createHiringRequest.mock.calls[0][0]).toMatchObject({
      candidate_full_name: "Nora Khalid",
      candidate_email: "nora@example.com",
      proposed_salary: "12000",
      cv_file: file,
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/hr/hiring-requests/12"));
  });

  it("refuses a CV whose type the backend would reject", async () => {
    render(<HiringRequestFormPage />);

    attachCv(new File(["x"], "resume.exe", { type: "application/octet-stream" }));

    expect(
      await screen.findByText("The CV must be a PDF, DOC, DOCX, JPG or PNG file."),
    ).toBeInTheDocument();
  });

  it("refuses a CV larger than 5 MB before uploading it", async () => {
    render(<HiringRequestFormPage />);

    attachCv(pdf("big.pdf", MAX_CV_SIZE_BYTES + 1));

    expect(await screen.findByText("The CV must be 5 MB or smaller.")).toBeInTheDocument();
  });

  it("saves then submits, and reports that the CEO was notified", async () => {
    createHiringRequest.mockResolvedValue(ok(makeHiringRequest({ id: 12 })));
    submitHiringRequest.mockResolvedValue(
      ok({ hiring_request: makeHiringRequest({ id: 12, status: "submitted" }), notifications: [] }),
    );

    render(<HiringRequestFormPage />);

    typeInto("Candidate Full Name", "Nora Khalid");
    attachCv(pdf());

    fireEvent.click(screen.getByRole("button", { name: /Submit to CEO/i }));

    await waitFor(() => expect(createHiringRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submitHiringRequest).toHaveBeenCalledWith(12));
    expect(await screen.findByText("Hiring request submitted to CEO.")).toBeInTheDocument();
  });

  it("will not submit without a CV, because the backend requires one", async () => {
    render(<HiringRequestFormPage />);

    typeInto("Candidate Full Name", "Nora Khalid");

    fireEvent.click(screen.getByRole("button", { name: /Submit to CEO/i }));

    expect(
      await screen.findByText("Attach a CV before submitting to the CEO."),
    ).toBeInTheDocument();
    expect(createHiringRequest).not.toHaveBeenCalled();
    expect(submitHiringRequest).not.toHaveBeenCalled();
  });

  it("requires the candidate name before anything is sent", async () => {
    render(<HiringRequestFormPage />);

    fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

    expect(await screen.findAllByText("This field is required.")).not.toHaveLength(0);
    expect(createHiringRequest).not.toHaveBeenCalled();
  });
});
