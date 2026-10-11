import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

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

import { MemoryRouter } from "react-router-dom";

import DocumentIntegrityPanel from "./DocumentIntegrityPanel";
import * as integrityApi from "../../services/api/documentIntegrityApi";
import { normalizeIntegrity } from "../../services/api/documentIntegrityApi";
import { useI18nStore } from "../../i18n/i18nStore";

const mocked = integrityApi as unknown as Record<
  "getDocumentIntegrity" | "verifyDocumentIntegrity" | "retryDocumentSeal",
  ReturnType<typeof vi.fn>
>;

const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const integrity = (overrides: Record<string, unknown> = {}) =>
  normalizeIntegrity({
    status: "sealed_valid",
    frozen_at: "2026-10-01T09:00:00Z",
    sha256: HASH,
    signing_mode: "seal",
    seal: {
      present: true,
      valid: true,
      timestamped: true,
      timestamp: "2026-10-01T09:00:05Z",
      signer: "FFI Document Seal",
      trust: "trusted",
    },
    signatures: [
      {
        role: "manager",
        signer_name: "Omar Reda",
        signed_at: "2026-09-30T08:00:00Z",
        valid: true,
        certificate_serial: "1A",
      },
    ],
    events: [
      { event: "frozen", at: "2026-10-01T09:00:00Z", by: null },
      { event: "downloaded", at: "2026-10-02T10:00:00Z", by: "Sara Ahmed" },
    ],
    ...overrides,
  });

beforeEach(() => {
  mocked.getDocumentIntegrity.mockReset();
  mocked.verifyDocumentIntegrity.mockReset();
  mocked.retryDocumentSeal.mockReset();
  useI18nStore.getState().setLanguage("en");
});

describe("DocumentIntegrityPanel", () => {
  it("shows the neutral state without calling the API before final approval", () => {
    render(<DocumentIntegrityPanel requestId={3} isFinal={false} />);
    expect(screen.getByTestId("integrity-not-frozen")).toHaveTextContent(
      "locked and fingerprinted when the document receives final approval",
    );
    expect(mocked.getDocumentIntegrity).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Verify now/ }),
    ).not.toBeInTheDocument();
  });

  it("explains legacy approved requests without alarming wording", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      normalizeIntegrity({ status: "not_frozen" }),
    );
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    expect(await screen.findByTestId("integrity-not-frozen")).toHaveTextContent(
      "approved before document locking was introduced",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a valid sealed document with hash, signers and history", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(integrity());
    render(<DocumentIntegrityPanel requestId={3} isFinal />);

    const chip = await screen.findByTestId("integrity-status");
    expect(chip).toHaveTextContent("Sealed, valid");
    expect(chip).toHaveAttribute("data-tone", "success");
    expect(screen.queryByText("9f86d081884c…f00a08")).not.toBeInTheDocument();
    expect(screen.getByText("Omar Reda")).toBeInTheDocument();
    expect(
      screen.getByText("FFI Document Seal", { exact: false }),
    ).toBeInTheDocument();
    // History is collapsed until the reader opens it.
    fireEvent.click(screen.getByText(/^History \(2\)$/));
    expect(await screen.findByText("Sara Ahmed")).toBeVisible();
    expect(screen.getByText("Downloaded")).toBeInTheDocument();
    expect(screen.queryByText("Internal certificate")).not.toBeInTheDocument();
    expect(mocked.getDocumentIntegrity).toHaveBeenCalledWith("leave", 3);
  });

  it("links signer and actor names to profiles only when a path and id exist", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({
        signatures: [
          {
            role: "line_manager",
            signer_name: "Omar Reda",
            signed_at: "2026-09-30T08:00:00Z",
            valid: true,
            certificate_serial: "1A",
            profile_id: 7,
          },
        ],
        events: [
          {
            event: "downloaded",
            at: "2026-10-02T10:00:00Z",
            by: "Sara Ahmed",
            by_profile_id: 9,
          },
          {
            event: "verified",
            at: "2026-10-02T10:05:00Z",
            by: "No Profile",
            by_profile_id: null,
          },
        ],
      }),
    );
    render(
      <MemoryRouter>
        <DocumentIntegrityPanel
          requestId={3}
          isFinal
          profilePath={(id) => `/hr/employees/${id}`}
        />
      </MemoryRouter>,
    );
    await screen.findByTestId("integrity-status");
    fireEvent.click(screen.getByText(/^History \(2\)$/));
    expect(screen.getByRole("link", { name: "Omar Reda" })).toHaveAttribute(
      "href",
      "/hr/employees/7",
    );
    expect(
      await screen.findByRole("link", { name: "Sara Ahmed" }),
    ).toHaveAttribute("href", "/hr/employees/9");
    expect(
      screen.queryByRole("link", { name: "No Profile" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No Profile")).toBeInTheDocument();
  });

  it("notes an untrusted internal root with a plain-language explanation", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({
        seal: { present: true, valid: true, trust: "untrusted_root" },
      }),
    );
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    const note = await screen.findByLabelText(
      /Internal certificate: .*internal certificate authority/,
    );
    expect(note).toHaveAttribute("tabindex", "0");
  });

  it("raises a red alert for a tampered document", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({ status: "tampered" }),
    );
    render(<DocumentIntegrityPanel requestId={3} isFinal canRetrySeal />);
    const chip = await screen.findByTestId("integrity-status");
    expect(chip).toHaveAttribute("data-tone", "error");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "no longer matches the fingerprint",
    );
    expect(
      screen.queryByRole("button", { name: /Retry seal/ }),
    ).not.toBeInTheDocument();
  });

  it("offers Retry seal to HR only when the seal failed", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({ status: "seal_failed", seal: { present: false } }),
    );
    mocked.retryDocumentSeal.mockResolvedValue(
      integrity({ status: "seal_pending", seal: { present: false } }),
    );
    const { unmount } = render(
      <DocumentIntegrityPanel requestId={3} isFinal />,
    );
    await screen.findByTestId("integrity-status");
    expect(
      screen.queryByRole("button", { name: /Retry seal/ }),
    ).not.toBeInTheDocument();
    unmount();

    render(<DocumentIntegrityPanel requestId={3} isFinal canRetrySeal />);
    fireEvent.click(await screen.findByRole("button", { name: /Retry seal/ }));
    await waitFor(() =>
      expect(screen.getByTestId("integrity-status")).toHaveTextContent(
        "Seal pending",
      ),
    );
    expect(mocked.retryDocumentSeal).toHaveBeenCalledWith("leave", 3);
  });

  it("re-verifies on demand and shows the fresh result", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({ status: "frozen_valid", seal: { present: false } }),
    );
    mocked.verifyDocumentIntegrity.mockResolvedValue(
      integrity({ status: "missing_file" }),
    );
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    fireEvent.click(await screen.findByRole("button", { name: /Verify now/ }));
    await waitFor(() =>
      expect(screen.getByTestId("integrity-status")).toHaveTextContent(
        "File missing",
      ),
    );
  });

  it("shows a retryable error when loading fails", async () => {
    mocked.getDocumentIntegrity
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce(integrity());
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    expect(
      await screen.findByText("Could not load the document integrity status."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("integrity-status")).toBeInTheDocument();
  });

  it("stays quiet when the viewer is outside the document's audience", async () => {
    mocked.getDocumentIntegrity.mockRejectedValue({
      response: { status: 404 },
    });
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    expect(
      await screen.findByTestId("integrity-unavailable"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("document-integrity-panel")).queryByRole(
        "alert",
      ),
    ).not.toBeInTheDocument();
  });

  it("marks a revoked approver certificate", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({
        status: "tampered",
        signatures: [
          {
            role: "hr_manual",
            signer_name: "Huda HR",
            signed_at: "2026-09-30T08:00:00Z",
            valid: false,
            certificate_serial: "2B",
            revoked: true,
            trust: "trusted",
          },
        ],
      }),
    );
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    expect(await screen.findByText("Certificate revoked")).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    expect(screen.getByText("HR (manual record)")).toBeInTheDocument();
  });

  it("uses the loan integrity endpoints when documentType is loan", async () => {
    mocked.getDocumentIntegrity.mockResolvedValue(
      integrity({ status: "seal_failed", seal: { present: false } }),
    );
    mocked.verifyDocumentIntegrity.mockResolvedValue(
      integrity({ status: "seal_failed", seal: { present: false } }),
    );
    mocked.retryDocumentSeal.mockResolvedValue(integrity());
    render(
      <DocumentIntegrityPanel
        documentType="loan"
        requestId={12}
        isFinal
        canRetrySeal
      />,
    );
    expect(await screen.findByTestId("integrity-status")).toHaveTextContent(
      "Seal failed",
    );
    expect(mocked.getDocumentIntegrity).toHaveBeenCalledWith("loan", 12);
    expect(screen.getByTestId("document-integrity-panel")).toHaveAttribute(
      "data-document-type",
      "loan",
    );

    fireEvent.click(screen.getByRole("button", { name: /Verify now/ }));
    await waitFor(() =>
      expect(mocked.verifyDocumentIntegrity).toHaveBeenCalledWith("loan", 12),
    );
    fireEvent.click(screen.getByRole("button", { name: /Retry seal/ }));
    await waitFor(() =>
      expect(mocked.retryDocumentSeal).toHaveBeenCalledWith("loan", 12),
    );
    expect(await screen.findByText("Sealed, valid")).toBeInTheDocument();
  });

  it("renders nothing for a type the backend has not rolled out", () => {
    const endpoints = integrityApi.INTEGRITY_ENDPOINTS;
    const saved = endpoints.penalty;
    endpoints.penalty = null;
    try {
      const { container } = render(
        <DocumentIntegrityPanel documentType="penalty" requestId={4} isFinal />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(mocked.getDocumentIntegrity).not.toHaveBeenCalled();
    } finally {
      endpoints.penalty = saved;
    }
  });

  it("renders Arabic labels", async () => {
    useI18nStore.getState().setLanguage("ar");
    mocked.getDocumentIntegrity.mockResolvedValue(integrity());
    render(<DocumentIntegrityPanel requestId={3} isFinal />);
    expect(await screen.findByTestId("integrity-status")).toHaveTextContent(
      "مختوم، صالح",
    );
    expect(screen.getByText("سلامة المستند")).toBeInTheDocument();
  });
});
