import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/api/loanApi", () => ({
  downloadLoanRequestPdf: vi.fn(),
}));

vi.mock("../../services/api/downloads", () => ({
  triggerBlobDownload: vi.fn(),
}));

import LoanPdfDownloadButton from "./LoanPdfDownloadButton";
import { downloadLoanRequestPdf } from "../../services/api/loanApi";
import { triggerBlobDownload } from "../../services/api/downloads";
import { useI18nStore } from "../../i18n/i18nStore";

const downloadMock = downloadLoanRequestPdf as unknown as ReturnType<
  typeof vi.fn
>;
const saveMock = triggerBlobDownload as unknown as ReturnType<typeof vi.fn>;

/** The backend answers blob requests with a Blob body even on an error. */
const httpError = (status: number) => {
  const error = new Error("request failed") as Error & {
    response: { status: number; data: Blob };
  };
  error.response = { status, data: new Blob(["{}"]) };
  return error;
};

beforeEach(() => {
  downloadMock.mockReset();
  saveMock.mockReset();
  useI18nStore.getState().setLanguage("en");
});

describe("LoanPdfDownloadButton", () => {
  it("saves the authenticated blob under a predictable filename", async () => {
    const blob = new Blob(["%PDF"], { type: "application/octet-stream" });
    downloadMock.mockResolvedValue(blob);

    render(<LoanPdfDownloadButton loanId={42} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(downloadMock).toHaveBeenCalledWith(42);
    expect(saveMock).toHaveBeenCalledWith(blob, "loan_request_42.pdf");
  });

  it("explains a 403 and saves nothing when the loan belongs to someone else", async () => {
    downloadMock.mockRejectedValue(httpError(403));

    render(<LoanPdfDownloadButton loanId={42} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));

    expect(
      await screen.findByText(
        "You are not allowed to download this loan request PDF.",
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("explains a 404 for a loan outside the active company scope", async () => {
    downloadMock.mockRejectedValue(httpError(404));

    render(<LoanPdfDownloadButton loanId={42} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));

    expect(
      await screen.findByText(
        "This loan request PDF is not available.",
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("explains a 401 without leaking the raw error", async () => {
    downloadMock.mockRejectedValue(httpError(401));

    render(<LoanPdfDownloadButton loanId={42} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));

    expect(
      await screen.findByText(
        "Your session expired. Sign in and try again.",
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("renders the Arabic label", () => {
    useI18nStore.getState().setLanguage("ar");

    render(<LoanPdfDownloadButton loanId={42} />);

    expect(
      screen.getByRole("button", { name: /تنزيل PDF/ }),
    ).toBeInTheDocument();
  });
});
