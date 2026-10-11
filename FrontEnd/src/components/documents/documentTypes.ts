import {
  DOCUMENT_INTEGRITY_TYPES,
  type DocumentIntegrityType,
  type MatchedRecord,
} from "../../services/api/documentIntegrityApi";

/** Viewer surfaces that have their own detail route for a document. */
export type DocumentViewerRole = "hr" | "employee" | "manager" | "ceo" | "cfo";

type PathBuilder = (id: number | string) => string;

export interface DocumentTypeConfig {
  type: DocumentIntegrityType;
  /** i18n key of the human label ("Loan request", ...). */
  labelKey: string;
  /**
   * Other spellings the backend may use for `matched_record.type` (its
   * registry `api_type`, model-style names). The key itself always matches.
   */
  aliases: readonly string[];
  /**
   * Record detail routes per viewer surface. A role without a route gets the
   * reference as plain text. `hr` covers HRManager and SystemAdmin.
   */
  detailPaths: Partial<Record<DocumentViewerRole, PathBuilder>>;
  /**
   * Record statuses at or after final approval, when the backend has frozen
   * the PDF. Only these ask the API for the integrity state. Empty until the
   * module is rolled out.
   */
  finalStatuses: readonly string[];
}

/**
 * One entry per approval-workflow document. Endpoint builders live in
 * `services/api/documentIntegrityApi.ts` (`INTEGRITY_ENDPOINTS`); this map
 * holds the UI side: label and where a matched record opens.
 */
export const DOCUMENT_TYPES: Record<DocumentIntegrityType, DocumentTypeConfig> =
  {
    leave: {
      type: "leave",
      labelKey: "documentIntegrity.type.leave",
      aliases: ["leave_request", "leaverequest", "hr_manual_leave"],
      detailPaths: {
        hr: (id) => `/hr/leave/requests/${id}`,
        employee: (id) => `/employee/leave/requests/${id}`,
        manager: (id) => `/manager/leave/requests/${id}`,
        ceo: (id) => `/ceo/leave/requests/${id}`,
      },
      finalStatuses: ["approved"],
    },
    loan: {
      type: "loan",
      labelKey: "documentIntegrity.type.loan",
      aliases: ["loan_request", "loanrequest"],
      detailPaths: {
        hr: (id) => `/hr/loan-requests/${id}`,
        employee: (id) => `/employee/loans/${id}`,
        manager: (id) => `/manager/loan-requests/${id}`,
        ceo: (id) => `/ceo/loan-requests/${id}`,
        cfo: (id) => `/cfo/loan-requests/${id}`,
      },
      // The form's last column is disbursement: the backend freezes the PDF
      // when the accountant disburses (status "approved"); payroll deduction
      // keeps that document. pending_disbursement still renders live.
      finalStatuses: ["approved", "deducted"],
    },
    permission: {
      type: "permission",
      labelKey: "documentIntegrity.type.permission",
      aliases: [
        "permission_request",
        "permissionrequest",
        "exit_permission",
        "exit_permission_request",
      ],
      detailPaths: {
        hr: (id) => `/hr/permission-requests/${id}`,
        employee: (id) => `/employee/permission-requests/${id}`,
        manager: (id) => `/manager/permission-requests/${id}`,
      },
      // Frozen on the transition to approved (HR decision, or the manager
      // decision when it already ends there). Only pending requests cancel.
      finalStatuses: ["approved"],
    },
    job_offer: {
      type: "job_offer",
      labelKey: "documentIntegrity.type.job_offer",
      aliases: ["joboffer", "job_offers"],
      detailPaths: {
        hr: (id) => `/hr/job-offers/${id}`,
        ceo: (id) => `/ceo/job-offers/${id}`,
      },
      // Frozen when HR sends it (v1) and re-frozen at the candidate's answer
      // (v2); a sent offer that is cancelled or expires keeps its copy. A
      // draft can also be cancelled, so pages also require `sent_at`.
      finalStatuses: ["sent", "accepted", "rejected", "expired", "cancelled"],
    },
    starting_work: {
      type: "starting_work",
      labelKey: "documentIntegrity.type.starting_work",
      aliases: [
        "starting_work_acknowledgment",
        "starting_work_acknowledgement",
        "startingworkacknowledgment",
      ],
      detailPaths: {
        hr: (id) => `/hr/starting-work-acknowledgments/${id}`,
      },
      // Frozen at HR approval; rejected and voided records never are.
      finalStatuses: ["approved"],
    },
    penalty: {
      type: "penalty",
      labelKey: "documentIntegrity.type.penalty",
      aliases: ["penalty_case", "penaltycase", "penalties"],
      detailPaths: {
        hr: (id) => `/hr/penalties/${id}`,
        employee: (id) => `/employee/penalties/${id}`,
      },
      finalStatuses: [],
    },
    contract_rating: {
      type: "contract_rating",
      labelKey: "documentIntegrity.type.contract_rating",
      aliases: ["contractrating", "contract_rating_record"],
      detailPaths: {
        hr: (id) => `/hr/contract-ratings/${id}`,
        ceo: (id) => `/ceo/contract-ratings/${id}`,
      },
      // One canonical decision copy, frozen when the CEO decision ends DECIDED
      // (re-frozen as v2 when a late HR comment changes the printed HR signer).
      finalStatuses: ["DECIDED"],
    },
    annual_entitlement: {
      type: "annual_entitlement",
      labelKey: "documentIntegrity.type.annual_entitlement",
      aliases: [
        "annual_entitlements",
        "annual_leave_payment",
        "annual_leave_payment_request",
        "annualleavepaymentrequest",
      ],
      detailPaths: {
        hr: (id) => `/hr/annual-leave-payments/${id}`,
        ceo: (id) => `/ceo/annual-leave-payments/${id}`,
      },
      // CEO approval ends at either: paid (approved) or carried forward.
      finalStatuses: ["approved", "carried_forward"],
    },
    asset_return: {
      type: "asset_return",
      labelKey: "documentIntegrity.type.asset_return",
      aliases: ["asset_return_request", "assetreturnrequest"],
      // Return requests have no record route of their own (they open inside
      // the asset details), so a match is shown as plain text.
      detailPaths: {},
      // The form's last row is "Processed": APPROVED still renders live.
      finalStatuses: ["PROCESSED"],
    },
    asset_damage: {
      type: "asset_damage",
      labelKey: "documentIntegrity.type.asset_damage",
      aliases: ["asset_damage_report", "assetdamagereport"],
      detailPaths: {},
      // Frozen at the CEO approval.
      finalStatuses: ["APPROVED"],
    },
  };

/**
 * Letters the backend checks by the hash stored at issuance only (no frozen
 * copy, no integrity endpoints, no panel): verify-upload can still name them.
 * Warning notices open their penalty on the HR route; late notices have none.
 */
const HASH_ONLY_TYPES: Record<
  string,
  { labelKey: string; hrPath: (record: MatchedRecord) => string | null }
> = {
  warning_notice: {
    labelKey: "documentIntegrity.type.warning_notice",
    hrPath: (record) =>
      record.penalty_id ? `/hr/penalties/${record.penalty_id}` : null,
  },
  late_notice: {
    labelKey: "documentIntegrity.type.late_notice",
    hrPath: () => null,
  },
};

const hashOnlyType = (raw: string | null | undefined) =>
  HASH_ONLY_TYPES[(raw ?? "").trim().toLowerCase()] ?? null;

/** i18n label key of a verify-upload match, or null for an unknown type. */
export function matchedRecordLabelKey(record: MatchedRecord): string | null {
  return (
    resolveDocumentType(record.type)?.labelKey ??
    hashOnlyType(record.type)?.labelKey ??
    null
  );
}

/** Maps a backend `matched_record.type` (or a type key) to its config. */
export function resolveDocumentType(
  raw: string | null | undefined,
): DocumentTypeConfig | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  for (const type of DOCUMENT_INTEGRITY_TYPES) {
    const config = DOCUMENT_TYPES[type];
    if (type === value || config.aliases.includes(value)) return config;
  }
  return null;
}

/** Detail route of a document for the viewer's surface, or null. */
export function documentRecordPath(
  type: string | null | undefined,
  id: number | string,
  role: DocumentViewerRole = "hr",
): string | null {
  const build = resolveDocumentType(type)?.detailPaths[role];
  return build ? build(id) : null;
}

/** Route of a verify-upload match for HR/admin viewers, or null. */
export function matchedRecordPath(
  record: MatchedRecord,
  role: DocumentViewerRole = "hr",
): string | null {
  const notice = hashOnlyType(record.type);
  if (notice) return role === "hr" ? notice.hrPath(record) : null;
  return documentRecordPath(record.type, record.id, role);
}

/** True when a record of this type has reached final approval. */
export function isDocumentFinal(
  type: DocumentIntegrityType,
  status: string | null | undefined,
): boolean {
  return (
    Boolean(status) && DOCUMENT_TYPES[type].finalStatuses.includes(status!)
  );
}
