import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock(
  "../../../services/api/documentIntegrityApi",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../services/api/documentIntegrityApi")
      >();
    return { ...actual, verifyDocumentUpload: vi.fn() };
  },
);

import VerifyDocumentPage from "./VerifyDocumentPage";
import * as integrityApi from "../../../services/api/documentIntegrityApi";
import { normalizeVerifyUpload } from "../../../services/api/documentIntegrityApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const verifyMock = integrityApi.verifyDocumentUpload as unknown as ReturnType<
  typeof vi.fn
>;

function pick(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const pdf = () =>
  new File(["%PDF-1.7"], "leave_request_38.pdf", { type: "application/pdf" });

beforeEach(() => {
  verifyMock.mockReset();
  useI18nStore.getState().setLanguage("en");
});

function renderPage() {
  return render(
    <MemoryRouter>
      <VerifyDocumentPage />
    </MemoryRouter>,
  );
}

describe("VerifyDocumentPage", () => {
  it("keeps the check button disabled until a PDF is chosen", () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: /Check document/ }),
    ).toBeDisabled();
    expect(screen.getByText("No file selected")).toBeInTheDocument();
  });

  it("rejects non-PDF files before uploading", async () => {
    renderPage();
    pick(new File(["x"], "photo.png", { type: "image/png" }));
    expect(
      await screen.findByText("Please choose a PDF file."),
    ).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("shows the matched record and integrity result", async () => {
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: { type: "leave_request", id: 38, reference: "LV-38" },
        integrity: {
          status: "frozen_valid",
          frozen_at: "2026-10-01T09:00:00Z",
          sha256: "ab".repeat(32),
        },
        summary: "This file matches the approved copy.",
      }),
    );
    renderPage();
    pick(pdf());
    await screen.findByText("leave_request_38.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Check document/ }));

    const result = await screen.findByTestId("verify-result");
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("integrity-status")).toHaveTextContent(
      "Locked, unchanged",
    );
    // The English-only backend summary is replaced by a translated sentence.
    expect(result).toHaveTextContent(
      "The file is identical to the approved document stored by the system.",
    );
    expect(result).not.toHaveTextContent(
      "This file matches the approved copy.",
    );
    expect(screen.getByRole("link", { name: "LV-38" })).toHaveAttribute(
      "href",
      "/hr/leave/requests/38",
    );
    expect(screen.getByTestId("verify-matched-type")).toHaveTextContent(
      "Leave request",
    );
  });

  it.each([
    ["loan", "LN-7", "/hr/loan-requests/7", "Loan request"],
    ["loan_request", "LN-7", "/hr/loan-requests/7", "Loan request"],
    [
      "permission_request",
      "PR-7",
      "/hr/permission-requests/7",
      "Permission request",
    ],
    ["job_offer", "JO-7", "/hr/job-offers/7", "Job offer"],
    [
      "starting_work",
      "SW-7",
      "/hr/starting-work-acknowledgments/7",
      "Starting work acknowledgment",
    ],
    ["penalty", "PN-7", "/hr/penalties/7", "Penalty"],
    ["contract_rating", "CR-7", "/hr/contract-ratings/7", "Contract rating"],
    [
      "annual_entitlement",
      "AE-7",
      "/hr/annual-leave-payments/7",
      "Annual leave settlement",
    ],
  ])(
    "links a matched %s record to its HR page with a type label",
    async (type, reference, href, label) => {
      verifyMock.mockResolvedValue(
        normalizeVerifyUpload({
          matched_record: { type, id: 7, reference },
          integrity: { status: "sealed_valid", seal: { present: true } },
          summary: null,
        }),
      );
      renderPage();
      pick(pdf());
      fireEvent.click(
        await screen.findByRole("button", { name: /Check document/ }),
      );
      expect(
        await screen.findByRole("link", { name: reference }),
      ).toHaveAttribute("href", href);
      expect(screen.getByTestId("verify-matched-type")).toHaveTextContent(
        label,
      );
    },
  );

  it.each([
    ["asset_return", "AR-77", "Asset return request"],
    ["asset_damage", "12", "Asset damage report"],
  ])(
    "labels a matched %s record and shows its reference as plain text",
    async (type, reference, label) => {
      verifyMock.mockResolvedValue(
        normalizeVerifyUpload({
          matched_record: { type, id: 12, reference },
          integrity: { status: "frozen_valid" },
          summary: null,
        }),
      );
      renderPage();
      pick(pdf());
      fireEvent.click(
        await screen.findByRole("button", { name: /Check document/ }),
      );
      expect(
        await screen.findByTestId("verify-matched-type"),
      ).toHaveTextContent(label);
      expect(screen.getByText(reference)).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: reference }),
      ).not.toBeInTheDocument();
    },
  );

  it("shows a superseded job-offer version as a calm info line", async () => {
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: {
          type: "job_offer",
          id: 9,
          reference: "JO-9",
          superseded_version: 1,
        },
        integrity: { status: "frozen_valid" },
        summary:
          "This file is an earlier approved version; a newer version has since been issued.",
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(
      await screen.findByRole("button", { name: /Check document/ }),
    );
    const note = await screen.findByTestId("verify-superseded");
    expect(note).toHaveTextContent(
      "This is a genuine copy of version 1 of this document. A newer version has since been issued.",
    );
    expect(note.className).toContain("ant-alert-info");
    expect(screen.getByTestId("integrity-status")).toHaveTextContent(
      "Locked, unchanged",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the superseded note in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: {
          type: "job_offer",
          id: 9,
          reference: "JO-9",
          superseded_version: 1,
        },
        integrity: { status: "frozen_valid" },
        summary: null,
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(await screen.findByRole("button", { name: /فحص المستند/ }));
    expect(await screen.findByTestId("verify-superseded")).toHaveTextContent(
      "هذه نسخة أصلية من الإصدار 1",
    );
  });

  it("omits the superseded note for a current version", async () => {
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: { type: "job_offer", id: 9, reference: "JO-9" },
        integrity: { status: "frozen_valid" },
        summary: null,
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(
      await screen.findByRole("button", { name: /Check document/ }),
    );
    await screen.findByTestId("verify-result");
    expect(screen.queryByTestId("verify-superseded")).not.toBeInTheDocument();
  });

  async function check(raw: Parameters<typeof normalizeVerifyUpload>[0]) {
    verifyMock.mockResolvedValue(normalizeVerifyUpload(raw));
    renderPage();
    pick(pdf());
    fireEvent.click(
      await screen.findByRole("button", { name: /Check document/ }),
    );
    return screen.findByTestId("verify-result");
  }

  it("links a hash-verified warning notice to its penalty, calmly", async () => {
    const result = await check({
      matched_record: {
        type: "warning_notice",
        id: 5,
        reference: "PWN-1-5",
        penalty_id: 12,
      },
      integrity: { status: "frozen_valid", signing_mode: "hash_only" },
      summary: "Hash verified only.",
    });
    expect(screen.getByTestId("verify-matched-type")).toHaveTextContent(
      "Warning notice",
    );
    expect(screen.getByRole("link", { name: "PWN-1-5" })).toHaveAttribute(
      "href",
      "/hr/penalties/12",
    );
    expect(screen.getByTestId("integrity-status")).toHaveTextContent(
      "Hash verified, not signed",
    );
    expect(result).not.toHaveTextContent("Locked, unchanged");
    expect(result).toHaveTextContent(
      "its fingerprint matches the one stored at issuance",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a late notice as plain text with its label", async () => {
    await check({
      matched_record: { type: "late_notice", id: 7, reference: "LAN-1-7" },
      integrity: { status: "frozen_valid", signing_mode: "hash_only" },
      summary: null,
    });
    expect(screen.getByTestId("verify-matched-type")).toHaveTextContent(
      "Late attendance notice",
    );
    expect(screen.getByText("LAN-1-7")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "LAN-1-7" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an altered hash-only notice red", async () => {
    await check({
      matched_record: { type: "late_notice", id: 7, reference: "LAN-1-7" },
      integrity: { status: "tampered", signing_mode: "hash_only" },
      summary: null,
    });
    expect(screen.getByTestId("integrity-status")).toHaveAttribute(
      "data-tone",
      "error",
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the hash-only labels in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: {
          type: "warning_notice",
          id: 5,
          reference: "PWN-1-5",
          penalty_id: 12,
        },
        integrity: { status: "frozen_valid", signing_mode: "hash_only" },
        summary: null,
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(await screen.findByRole("button", { name: /فحص المستند/ }));
    expect(await screen.findByTestId("verify-matched-type")).toHaveTextContent(
      "خطاب إنذار",
    );
    expect(screen.getByTestId("integrity-status")).toHaveTextContent(
      "تم التحقق من البصمة، غير موقّع",
    );
  });

  it("labels a matched contract rating decision", async () => {
    await check({
      matched_record: {
        type: "contract_rating",
        id: 3,
        reference: "CR-3",
        superseded_version: 1,
      },
      integrity: { status: "sealed_valid", seal: { present: true } },
      summary: null,
    });
    expect(screen.getByRole("link", { name: "CR-3" })).toHaveAttribute(
      "href",
      "/hr/contract-ratings/3",
    );
    expect(screen.getByTestId("verify-superseded")).toBeInTheDocument();
  });

  it("shows an unknown matched type as plain text without a label", async () => {
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: { type: "mystery", id: 3, reference: "MY-3" },
        integrity: { status: "frozen_valid" },
        summary: null,
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(
      await screen.findByRole("button", { name: /Check document/ }),
    );
    expect(await screen.findByText("MY-3")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "MY-3" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-matched-type")).not.toBeInTheDocument();
  });

  it("labels the matched type in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: { type: "loan", id: 7, reference: "LN-7" },
        integrity: { status: "frozen_valid" },
        summary: null,
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(await screen.findByRole("button", { name: /فحص المستند/ }));
    expect(await screen.findByTestId("verify-matched-type")).toHaveTextContent(
      "طلب سلفة",
    );
  });

  it("reports an unmatched, altered file in red", async () => {
    verifyMock.mockResolvedValue(
      normalizeVerifyUpload({
        matched_record: null,
        integrity: { status: "tampered" },
        summary: null,
      }),
    );
    renderPage();
    pick(pdf());
    fireEvent.click(
      await screen.findByRole("button", { name: /Check document/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("integrity-status")).toHaveAttribute(
        "data-tone",
        "error",
      ),
    );
    expect(
      screen.getByText("No approved document matches this file."),
    ).toBeInTheDocument();
  });

  it("shows a translated error when the upload fails", async () => {
    verifyMock.mockRejectedValue({ response: { status: 500 } });
    renderPage();
    pick(pdf());
    fireEvent.click(
      await screen.findByRole("button", { name: /Check document/ }),
    );
    expect(await screen.findByText("Verification failed")).toBeInTheDocument();
  });
});
