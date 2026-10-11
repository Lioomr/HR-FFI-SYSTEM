import { describe, expect, it } from "vitest";

import { translations } from "../../i18n/translations";
import { DOCUMENT_INTEGRITY_TYPES } from "../../services/api/documentIntegrityApi";
import {
  DOCUMENT_TYPES,
  documentRecordPath,
  isDocumentFinal,
  matchedRecordLabelKey,
  matchedRecordPath,
  resolveDocumentType,
} from "./documentTypes";

describe("document type registry", () => {
  it("has one entry per integrity type with an HR route and EN/AR labels", () => {
    // Asset requests open inside the asset details, not on a route of their own.
    const withoutRoute = new Set(["asset_return", "asset_damage"]);
    for (const type of DOCUMENT_INTEGRITY_TYPES) {
      const config = DOCUMENT_TYPES[type];
      expect(config.type).toBe(type);
      if (withoutRoute.has(type)) expect(config.detailPaths.hr).toBeUndefined();
      else expect(config.detailPaths.hr?.(1)).toMatch(/^\/hr\//);
      expect(translations.en[config.labelKey]).toBeTruthy();
      expect(translations.ar[config.labelKey]).toBeTruthy();
    }
  });

  it("resolves keys and backend aliases case-insensitively", () => {
    expect(resolveDocumentType("leave")?.type).toBe("leave");
    expect(resolveDocumentType("leave_request")?.type).toBe("leave");
    expect(resolveDocumentType("Loan_Request")?.type).toBe("loan");
    expect(resolveDocumentType("annual_leave_payment_request")?.type).toBe(
      "annual_entitlement",
    );
    expect(resolveDocumentType("starting_work_acknowledgment")?.type).toBe(
      "starting_work",
    );
    expect(resolveDocumentType("unknown")).toBeNull();
    expect(resolveDocumentType("")).toBeNull();
    expect(resolveDocumentType(null)).toBeNull();
  });

  it("builds role-aware record routes and returns null without one", () => {
    expect(documentRecordPath("loan", 5)).toBe("/hr/loan-requests/5");
    expect(documentRecordPath("loan", 5, "employee")).toBe("/employee/loans/5");
    expect(documentRecordPath("loan", 5, "cfo")).toBe("/cfo/loan-requests/5");
    expect(documentRecordPath("starting_work", 5, "employee")).toBeNull();
    expect(documentRecordPath("nope", 5)).toBeNull();
    expect(
      matchedRecordPath({ type: "leave_request", id: 38, reference: null }),
    ).toBe("/hr/leave/requests/38");
  });

  it("knows which statuses are final per type", () => {
    expect(isDocumentFinal("leave", "approved")).toBe(true);
    expect(isDocumentFinal("leave", "pending_ceo")).toBe(false);
    expect(isDocumentFinal("loan", "pending_disbursement")).toBe(false);
    expect(isDocumentFinal("loan", "approved")).toBe(true);
    expect(isDocumentFinal("loan", "deducted")).toBe(true);
    expect(isDocumentFinal("loan", "pending_cfo")).toBe(false);
    expect(isDocumentFinal("loan", "rejected")).toBe(false);
    expect(isDocumentFinal("loan", undefined)).toBe(false);
    expect(isDocumentFinal("permission", "approved")).toBe(true);
    expect(isDocumentFinal("permission", "pending_hr")).toBe(false);
    expect(isDocumentFinal("annual_entitlement", "approved")).toBe(true);
    expect(isDocumentFinal("annual_entitlement", "carried_forward")).toBe(true);
    expect(isDocumentFinal("annual_entitlement", "pending_ceo")).toBe(false);
    expect(isDocumentFinal("job_offer", "draft")).toBe(false);
    expect(isDocumentFinal("job_offer", "sent")).toBe(true);
    expect(isDocumentFinal("job_offer", "accepted")).toBe(true);
    expect(isDocumentFinal("starting_work", "approved")).toBe(true);
    expect(isDocumentFinal("starting_work", "pending_hr")).toBe(false);
    expect(isDocumentFinal("asset_return", "APPROVED")).toBe(false);
    expect(isDocumentFinal("asset_return", "PROCESSED")).toBe(true);
    expect(isDocumentFinal("asset_damage", "PENDING_CEO")).toBe(false);
    expect(isDocumentFinal("asset_damage", "APPROVED")).toBe(true);
    expect(isDocumentFinal("contract_rating", "DECIDED")).toBe(true);
    expect(isDocumentFinal("contract_rating", "PENDING_CEO")).toBe(false);
    expect(
      isDocumentFinal("contract_rating", "MANUAL_RESOLUTION_REQUIRED"),
    ).toBe(false);
    // Penalties have no frozen document.
    expect(isDocumentFinal("penalty", "approved")).toBe(false);
  });

  it("maps the backend's matched_record types for the new modules", () => {
    for (const type of [
      "permission",
      "annual_entitlement",
      "job_offer",
      "starting_work",
      "asset_return",
      "asset_damage",
    ]) {
      expect(resolveDocumentType(type)?.type).toBe(type);
    }
    expect(resolveDocumentType("asset_return_request")?.type).toBe(
      "asset_return",
    );
    expect(resolveDocumentType("asset_damage_report")?.type).toBe(
      "asset_damage",
    );
    // No record route: the verify page shows the reference as plain text.
    expect(documentRecordPath("asset_return", 3)).toBeNull();
    expect(documentRecordPath("asset_damage", 3)).toBeNull();
    expect(documentRecordPath("job_offer", 3)).toBe("/hr/job-offers/3");
    expect(documentRecordPath("annual_entitlement", 3)).toBe(
      "/hr/annual-leave-payments/3",
    );
  });

  it("labels and links the hash-only notices", () => {
    const warning = {
      type: "warning_notice",
      id: 5,
      reference: "PWN-1-5",
      penalty_id: 12,
    };
    expect(matchedRecordLabelKey(warning)).toBe(
      "documentIntegrity.type.warning_notice",
    );
    expect(matchedRecordPath(warning)).toBe("/hr/penalties/12");
    expect(matchedRecordPath(warning, "employee")).toBeNull();
    expect(
      matchedRecordPath({ type: "warning_notice", id: 5, reference: null }),
    ).toBeNull();
    const late = { type: "late_notice", id: 7, reference: "LAN-1-7" };
    expect(matchedRecordLabelKey(late)).toBe(
      "documentIntegrity.type.late_notice",
    );
    expect(matchedRecordPath(late)).toBeNull();
    expect(
      matchedRecordLabelKey({
        type: "contract_rating",
        id: 1,
        reference: null,
      }),
    ).toBe("documentIntegrity.type.contract_rating");
    expect(
      matchedRecordLabelKey({ type: "mystery", id: 1, reference: null }),
    ).toBeNull();
    expect(
      translations.en["documentIntegrity.type.warning_notice"],
    ).toBeTruthy();
    expect(translations.ar["documentIntegrity.type.late_notice"]).toBeTruthy();
  });
});
