import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "./apiClient";
import {
  getDocumentIntegrity,
  getLeaveIntegrity,
  hasIntegrityEndpoints,
  integrityPath,
  isDocumentIntegrityType,
  retryDocumentSeal,
  verifyDocumentIntegrity,
  normalizeIntegrity,
  normalizeVerifyUpload,
  retryLeaveSeal,
  verifyDocumentUpload,
  verifyLeaveIntegrity,
  workpaperParams,
} from "./documentIntegrityApi";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

const ok = (data: unknown) => ({ data: { status: "success", data } });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("normalizeIntegrity", () => {
  it("treats an empty or unknown payload as not frozen", () => {
    expect(normalizeIntegrity(undefined).status).toBe("not_frozen");
    expect(normalizeIntegrity({ status: "weird" }).status).toBe("not_frozen");
    const empty = normalizeIntegrity({});
    expect(empty.seal).toEqual({
      present: false,
      valid: null,
      timestamped: false,
      timestamp: null,
      signer: null,
      trust: "unknown",
    });
    expect(empty.signatures).toEqual([]);
    expect(empty.events).toEqual([]);
  });

  it("keeps the documented fields and flattens actor objects", () => {
    const value = normalizeIntegrity({
      status: "signed_valid",
      frozen_at: "2026-10-01T09:00:00Z",
      sha256: "ab".repeat(32),
      signing_mode: "per_approver",
      seal: {
        present: true,
        valid: true,
        timestamped: true,
        timestamp: "2026-10-01T09:00:05Z",
        signer: "FFI Document Seal",
        trust: "untrusted_root",
      },
      signatures: [
        {
          role: "manager",
          signer_name: "Omar Reda",
          signed_at: "2026-10-01T08:00:00Z",
          valid: true,
          certificate_serial: "1A2B",
        },
      ],
      events: [
        { event: "frozen", at: "2026-10-01T09:00:00Z", by: null },
        {
          event: "downloaded",
          at: "2026-10-02T09:00:00Z",
          by: { full_name: "Sara" },
        },
      ],
    });
    expect(value.status).toBe("signed_valid");
    expect(value.seal.trust).toBe("untrusted_root");
    expect(value.signatures[0].signer_name).toBe("Omar Reda");
    expect(value.events.map((e) => e.by)).toEqual([null, "Sara"]);
  });
});

describe("normalizeVerifyUpload", () => {
  it("returns a null match when the backend found no record", () => {
    const value = normalizeVerifyUpload({
      matched_record: null,
      integrity: { status: "tampered" },
      summary: "No match",
    });
    expect(value.matched_record).toBeNull();
    expect(value.integrity.status).toBe("tampered");
    expect(value.summary).toBe("No match");
  });
});

describe("integrity endpoints", () => {
  it("reads, verifies and retries the seal on the leave request", async () => {
    get.mockResolvedValue(ok({ status: "frozen_valid" }));
    post.mockResolvedValue(ok({ status: "sealed_valid" }));

    expect((await getLeaveIntegrity(5)).status).toBe("frozen_valid");
    expect(get).toHaveBeenCalledWith("/api/leaves/leave-requests/5/integrity/");

    await verifyLeaveIntegrity(5);
    expect(post).toHaveBeenLastCalledWith(
      "/api/leaves/leave-requests/5/integrity/verify/",
    );

    await retryLeaveSeal(5);
    expect(post).toHaveBeenLastCalledWith(
      "/api/leaves/leave-requests/5/integrity/retry-seal/",
    );
  });

  it("uses each module's own viewset path for loans", async () => {
    get.mockResolvedValue(ok({ status: "frozen_valid" }));
    post.mockResolvedValue(ok({ status: "sealed_valid" }));

    await getDocumentIntegrity("loan", 8);
    expect(get).toHaveBeenCalledWith("/api/loans/loan-requests/8/integrity/");
    await verifyDocumentIntegrity("loan", 8);
    expect(post).toHaveBeenLastCalledWith(
      "/api/loans/loan-requests/8/integrity/verify/",
    );
    await retryDocumentSeal("loan", 8);
    expect(post).toHaveBeenLastCalledWith(
      "/api/loans/loan-requests/8/integrity/retry-seal/",
    );
  });

  it("uses the handoff paths for the rolled-out modules", async () => {
    get.mockResolvedValue(ok({ status: "frozen_valid" }));
    post.mockResolvedValue(ok({ status: "sealed_valid" }));
    const expected: [Parameters<typeof integrityPath>[0], string][] = [
      ["permission", "/api/permission-requests/4/integrity/"],
      ["annual_entitlement", "/api/leaves/annual-leave-payments/4/integrity/"],
      // APIView modules mounted without the /api prefix.
      ["job_offer", "/job-offers/4/integrity/"],
      ["starting_work", "/starting-work-acknowledgments/4/integrity/"],
      ["asset_return", "/api/assets/return-requests/4/integrity/"],
      ["asset_damage", "/api/assets/damage-reports/4/integrity/"],
      // DefaultRouter without /api; trailing slash required.
      ["contract_rating", "/contract-ratings/4/integrity/"],
    ];
    for (const [type, path] of expected) {
      expect(hasIntegrityEndpoints(type)).toBe(true);
      await getDocumentIntegrity(type, 4);
      expect(get).toHaveBeenLastCalledWith(path);
      await retryDocumentSeal(type, 4);
      expect(post).toHaveBeenLastCalledWith(`${path}retry-seal/`);
    }
    // Penalties have no frozen document (their notices are hash-only).
    expect(hasIntegrityEndpoints("penalty")).toBe(false);
  });

  it("builds the HR work-paper query with the browser timezone", () => {
    const params = workpaperParams();
    expect(params.workpaper).toBe(1);
    expect(params.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("keeps a superseded version number only when the backend sends one", () => {
    expect(
      normalizeVerifyUpload({
        matched_record: {
          type: "job_offer",
          id: 9,
          reference: "JO-9",
          superseded_version: 1,
        },
        integrity: { status: "frozen_valid" },
      }).matched_record?.superseded_version,
    ).toBe(1);
    expect(
      normalizeVerifyUpload({
        matched_record: { type: "job_offer", id: 9, reference: "JO-9" },
        integrity: { status: "frozen_valid" },
      }).matched_record,
    ).not.toHaveProperty("superseded_version");
    expect(
      normalizeVerifyUpload({
        matched_record: {
          type: "warning_notice",
          id: 5,
          reference: "PWN-1-5",
          penalty_id: 12,
        },
        integrity: { status: "frozen_valid", signing_mode: "hash_only" },
      }),
    ).toMatchObject({
      matched_record: { type: "warning_notice", penalty_id: 12 },
      integrity: { signing_mode: "hash_only" },
    });
  });

  it("knows which types are rolled out and refuses the others", () => {
    expect(hasIntegrityEndpoints("leave")).toBe(true);
    expect(hasIntegrityEndpoints("loan")).toBe(true);
    expect(isDocumentIntegrityType("loan")).toBe(true);
    expect(isDocumentIntegrityType("loan_request")).toBe(false);
    expect(integrityPath("leave", 2)).toBe(
      "/api/leaves/leave-requests/2/integrity/",
    );
  });

  it("posts the PDF as multipart field 'file'", async () => {
    post.mockResolvedValue(
      ok({
        matched_record: { type: "leave_request", id: 9, reference: "LV-9" },
        integrity: { status: "frozen_valid" },
        summary: null,
      }),
    );
    const file = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    const result = await verifyDocumentUpload(file);

    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/api/documents/verify-upload/");
    expect((body as FormData).get("file")).toBe(file);
    expect(result.matched_record).toEqual({
      type: "leave_request",
      id: 9,
      reference: "LV-9",
    });
  });

  it("throws the envelope message on an error response", async () => {
    get.mockResolvedValue({ data: { status: "error", message: "Nope" } });
    await expect(getLeaveIntegrity(1)).rejects.toThrow("Nope");
  });
});
