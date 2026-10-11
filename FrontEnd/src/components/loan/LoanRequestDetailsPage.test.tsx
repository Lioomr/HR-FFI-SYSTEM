import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/documentIntegrityApi", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../services/api/documentIntegrityApi")
    >();
  return {
    ...actual,
    getDocumentIntegrity: vi.fn(),
    verifyDocumentIntegrity: vi.fn(),
    retryDocumentSeal: vi.fn(),
  };
});

vi.mock("../../services/api/loanApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/api/loanApi")>();
  return {
    ...actual,
    downloadLoanRequestPdf: vi.fn(),
    getLoanRequestWorkpaperBlob: vi.fn(),
  };
});

const openPreview = vi.fn();
vi.mock("../ui/useFilePreview", () => ({
  useFilePreview: () => ({ openPreview, previewModal: null }),
}));

import LoanRequestDetailsPage from "./LoanRequestDetailsPage";
import * as integrityApi from "../../services/api/documentIntegrityApi";
import * as loanApi from "../../services/api/loanApi";
import { normalizeIntegrity } from "../../services/api/documentIntegrityApi";
import type { LoanRequest } from "../../services/api/loanApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getIntegrity = integrityApi.getDocumentIntegrity as unknown as ReturnType<
  typeof vi.fn
>;
const workpaper = loanApi.getLoanRequestWorkpaperBlob as unknown as ReturnType<
  typeof vi.fn
>;
const download = loanApi.downloadLoanRequestPdf as unknown as ReturnType<
  typeof vi.fn
>;

const loan = (overrides: Partial<LoanRequest> = {}): LoanRequest => ({
  id: 21,
  public_reference: "LN-21",
  employee: {
    id: 4,
    email: "sara@example.com",
    full_name: "Sara Ahmed",
    employee_profile_id: 40,
  },
  requested_amount: 3000,
  loan_type: "open",
  reason: "Car repair",
  status: "approved",
  decision_history: [],
  created_at: "2026-10-01T09:00:00Z",
  ...overrides,
});

const sealedFailed = normalizeIntegrity({
  status: "seal_failed",
  frozen_at: "2026-10-02T09:00:00Z",
  seal: { present: false },
  signatures: [
    {
      role: "ceo",
      signer_name: "Omar Reda",
      signed_at: "2026-10-02T08:00:00Z",
      valid: true,
      profile_id: 7,
    },
  ],
});

function renderPage(
  item: LoanRequest,
  props: Partial<Parameters<typeof LoanRequestDetailsPage>[0]> = {},
) {
  const fetchOne = vi.fn().mockResolvedValue({ status: "success", data: item });
  return render(
    <MemoryRouter initialEntries={[`/hr/loan-requests/${item.id}`]}>
      <Routes>
        <Route
          path="/hr/loan-requests/:id"
          element={
            <LoanRequestDetailsPage
              title="Loan review"
              backPath="/hr/loan-requests"
              fetchOne={fetchOne}
              approve={vi.fn()}
              canActWhenStatus="pending_hr"
              {...props}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getIntegrity.mockReset();
  workpaper.mockReset();
  download.mockReset();
  openPreview.mockReset();
  useI18nStore.getState().setLanguage("en");
});

describe("LoanRequestDetailsPage document integrity", () => {
  it("shows the loan integrity card with HR retry and profile links", async () => {
    getIntegrity.mockResolvedValue(sealedFailed);
    renderPage(loan(), {
      showPdfDownload: true,
      showPdfPreview: true,
      integrity: {
        canRetrySeal: true,
        profilePath: (id) => `/hr/employees/${id}`,
      },
    });

    expect(await screen.findByTestId("integrity-status")).toHaveTextContent(
      "Seal failed",
    );
    expect(getIntegrity).toHaveBeenCalledWith("loan", 21);
    expect(
      screen.getByRole("button", { name: /Retry seal/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Omar Reda" })).toHaveAttribute(
      "href",
      "/hr/employees/7",
    );
  });

  it("previews the HR work paper but keeps Download on the original", async () => {
    getIntegrity.mockResolvedValue(sealedFailed);
    const paper = new Blob(["%PDF-work"]);
    workpaper.mockResolvedValue(paper);
    download.mockResolvedValue(new Blob(["%PDF-orig"]));
    renderPage(loan(), { showPdfDownload: true, showPdfPreview: true });

    fireEvent.click(await screen.findByRole("button", { name: /Preview/ }));
    expect(openPreview).toHaveBeenCalledTimes(1);
    const request = openPreview.mock.calls[0][0];
    expect(request.filename).toBe("loan_request_21.pdf");
    await expect(request.load()).resolves.toBe(paper);
    expect(workpaper).toHaveBeenCalledWith(21);

    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(21));
  });

  it("gives other reviewers a read-only card without retry or links", async () => {
    getIntegrity.mockResolvedValue(sealedFailed);
    renderPage(loan({ status: "deducted" }));

    expect(await screen.findByTestId("integrity-status")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry seal/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Omar Reda" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Omar Reda")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Preview/ }),
    ).not.toBeInTheDocument();
  });

  it("does not call the API before disbursement completes the loan", async () => {
    renderPage(loan({ status: "pending_disbursement" }));
    expect(await screen.findByTestId("integrity-not-frozen")).toHaveTextContent(
      "locked and fingerprinted when the document receives final approval",
    );
    expect(getIntegrity).not.toHaveBeenCalled();
  });
});

describe("LoanRequestDetailsPage employee name", () => {
  it("links the employee to the HR profile only when HR passes it", async () => {
    renderPage(loan({ status: "pending_hr" }), {
      employeeProfilePath: (id) => `/hr/employees/${id}`,
    });
    const links = await screen.findAllByRole("link", { name: "Sara Ahmed" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links)
      expect(link).toHaveAttribute("href", "/hr/employees/40");
  });

  it("links the manager's view to the team member page", async () => {
    renderPage(loan({ status: "pending_manager" }), {
      employeeProfilePath: (id) => `/manager/team/${id}`,
    });
    const links = await screen.findAllByRole("link", { name: "Sara Ahmed" });
    for (const link of links)
      expect(link).toHaveAttribute("href", "/manager/team/40");
  });

  it("shows plain text to CFO/CEO viewers without a profile route", async () => {
    renderPage(loan({ status: "pending_cfo" }));
    expect((await screen.findAllByText("Sara Ahmed")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByRole("link", { name: "Sara Ahmed" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/hr/employees/"]')).toBeNull();
  });
});
