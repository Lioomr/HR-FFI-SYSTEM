import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import { unwrapApiData } from "./apiHelpers";

/**
 * Tamper-evidence for approved documents (leave, loan and the other
 * approval-workflow PDFs).
 *
 * At final approval the backend freezes the generated PDF, stores its SHA-256
 * and can seal it with the organization certificate (plus a trusted timestamp)
 * and per-approver signatures. These endpoints report and re-check that state.
 * Contract: plans/Document Signing API Handoff.md.
 */

export type IntegrityStatus =
  | "not_frozen"
  | "frozen_valid"
  | "sealed_valid"
  | "signed_valid"
  | "tampered"
  | "missing_file"
  | "seal_pending"
  | "seal_failed";

export type SealTrust = "trusted" | "untrusted_root" | "unknown";

export interface IntegritySeal {
  present: boolean;
  valid: boolean | null;
  timestamped: boolean;
  timestamp: string | null;
  signer: string | null;
  trust: SealTrust;
}

export interface IntegritySignature {
  role: string;
  signer_name: string;
  signed_at: string | null;
  valid: boolean | null;
  certificate_serial: string | null;
  revoked: boolean;
  trust: SealTrust;
  /** Employee profile of the signer; sent to HR/admin viewers only. */
  profile_id?: number | null;
}

export type IntegrityEventType =
  | "frozen"
  | "downloaded"
  | "verified"
  | "sealed"
  | "seal_retry"
  | (string & {});

export interface IntegrityEvent {
  event: IntegrityEventType;
  at: string | null;
  /** Display name of the actor, or null for system events. */
  by: string | null;
  /** Employee profile of the actor; sent to HR/admin viewers only. */
  by_profile_id?: number | null;
}

export interface DocumentIntegrity {
  status: IntegrityStatus;
  frozen_at: string | null;
  sha256: string | null;
  signing_mode: string | null;
  seal: IntegritySeal;
  signatures: IntegritySignature[];
  events: IntegrityEvent[];
}

export interface MatchedRecord {
  type: string;
  id: number | string;
  reference: string | null;
  /**
   * Present only when the upload matches an earlier, superseded version of
   * the record (e.g. a job offer's sent copy after the candidate answered).
   * The file is genuine; a newer version has since been issued.
   */
  superseded_version?: number | null;
  /** Warning notices only: the penalty the notice was issued for. */
  penalty_id?: number | null;
}

export interface VerifyUploadResult {
  matched_record: MatchedRecord | null;
  integrity: DocumentIntegrity;
  /** English-only backend sentence; the UI shows a translated equivalent. */
  summary: string | null;
}

const KNOWN_STATUSES: IntegrityStatus[] = [
  "not_frozen",
  "frozen_valid",
  "sealed_valid",
  "signed_valid",
  "tampered",
  "missing_file",
  "seal_pending",
  "seal_failed",
];

type Raw = Record<string, unknown> | null | undefined;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const boolOrNull = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

function actorName(value: unknown): string | null {
  if (typeof value === "string") return str(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      str(obj.full_name) ?? str(obj.name) ?? str(obj.email) ?? str(obj.username)
    );
  }
  return null;
}

const toTrust = (value: unknown): SealTrust =>
  value === "trusted" || value === "untrusted_root" ? value : "unknown";

/**
 * Accepts whatever the backend sends and fills safe defaults, so a partial or
 * older payload renders as "not frozen" instead of crashing the detail page.
 */
export function normalizeIntegrity(raw: Raw): DocumentIntegrity {
  const data = (raw ?? {}) as Record<string, unknown>;
  const status = KNOWN_STATUSES.includes(data.status as IntegrityStatus)
    ? (data.status as IntegrityStatus)
    : "not_frozen";
  const seal = (data.seal ?? {}) as Record<string, unknown>;

  return {
    status,
    frozen_at: str(data.frozen_at),
    sha256: str(data.sha256),
    signing_mode: str(data.signing_mode),
    seal: {
      present: seal.present === true,
      valid: boolOrNull(seal.valid),
      timestamped: seal.timestamped === true,
      timestamp: str(seal.timestamp),
      signer: actorName(seal.signer),
      trust: toTrust(seal.trust),
    },
    signatures: Array.isArray(data.signatures)
      ? data.signatures.map((item) => {
          const sig = (item ?? {}) as Record<string, unknown>;
          return {
            role: str(sig.role) ?? "",
            signer_name: actorName(sig.signer_name) ?? "",
            signed_at: str(sig.signed_at),
            valid: boolOrNull(sig.valid),
            certificate_serial: str(sig.certificate_serial),
            revoked: sig.revoked === true,
            trust: toTrust(sig.trust),
            profile_id: numOrNull(sig.profile_id),
          };
        })
      : [],
    events: Array.isArray(data.events)
      ? data.events.map((item) => {
          const ev = (item ?? {}) as Record<string, unknown>;
          return {
            event: (str(ev.event) ?? "") as IntegrityEventType,
            at: str(ev.at),
            by: actorName(ev.by),
            by_profile_id: numOrNull(ev.by_profile_id),
          };
        })
      : [],
  };
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeVerifyUpload(raw: Raw): VerifyUploadResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const matched = data.matched_record as Record<string, unknown> | null;
  return {
    matched_record:
      matched && (typeof matched.id === "number" || str(matched.id))
        ? {
            type: str(matched.type) ?? "",
            id: matched.id as number | string,
            reference: str(matched.reference),
            // Sent only for a match on an earlier version; kept absent
            // otherwise, exactly as the backend does.
            ...(numOrNull(matched.superseded_version) !== null
              ? { superseded_version: numOrNull(matched.superseded_version) }
              : {}),
            ...(numOrNull(matched.penalty_id) !== null
              ? { penalty_id: numOrNull(matched.penalty_id) }
              : {}),
          }
        : null,
    integrity: normalizeIntegrity(data.integrity as Raw),
    summary: str(data.summary),
  };
}

/**
 * Approval-workflow documents that can be frozen, sealed and verified. Each
 * module exposes identical `integrity/`, `integrity/verify/` and
 * `integrity/retry-seal/` actions on its own request viewset.
 */
export const DOCUMENT_INTEGRITY_TYPES = [
  "leave",
  "loan",
  "permission",
  "job_offer",
  "starting_work",
  "penalty",
  "contract_rating",
  "annual_entitlement",
  "asset_return",
  "asset_damage",
] as const;

export type DocumentIntegrityType = (typeof DOCUMENT_INTEGRITY_TYPES)[number];

type IntegrityBasePath = (id: number | string) => string;

/**
 * Base `integrity/` path per document type (verify and retry-seal hang off
 * it). `null` means the backend has not rolled the type out yet: the panel
 * then renders nothing instead of calling a route that would 404.
 * Source of truth: plans/Document Signing API Handoff.md.
 */
export const INTEGRITY_ENDPOINTS: Record<
  DocumentIntegrityType,
  IntegrityBasePath | null
> = {
  leave: (id) => `/api/leaves/leave-requests/${id}/integrity/`,
  loan: (id) => `/api/loans/loan-requests/${id}/integrity/`,
  permission: (id) => `/api/permission-requests/${id}/integrity/`,
  // Job offers and starting work are APIView modules without the /api prefix.
  job_offer: (id) => `/job-offers/${id}/integrity/`,
  starting_work: (id) => `/starting-work-acknowledgments/${id}/integrity/`,
  // Penalties have no frozen document (their warning notices are hash-only
  // and are checked through verify-upload alone).
  penalty: null,
  // DefaultRouter without the /api prefix; the trailing slash is required.
  contract_rating: (id) => `/contract-ratings/${id}/integrity/`,
  annual_entitlement: (id) =>
    `/api/leaves/annual-leave-payments/${id}/integrity/`,
  asset_return: (id) => `/api/assets/return-requests/${id}/integrity/`,
  asset_damage: (id) => `/api/assets/damage-reports/${id}/integrity/`,
};

/**
 * Query parameters of the HR "work paper" PDF preview: the frozen form plus
 * an approval-trail page with times in this browser's timezone. The backend
 * honours them for HRManager/SystemAdmin only. Never the verifiable original,
 * so plain downloads must not send them.
 */
export function workpaperParams(): { workpaper: 1; tz: string } {
  return {
    workpaper: 1,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function isDocumentIntegrityType(
  value: unknown,
): value is DocumentIntegrityType {
  return (
    typeof value === "string" &&
    (DOCUMENT_INTEGRITY_TYPES as readonly string[]).includes(value)
  );
}

/** True when the backend exposes integrity endpoints for this type. */
export function hasIntegrityEndpoints(type: DocumentIntegrityType): boolean {
  return Boolean(INTEGRITY_ENDPOINTS[type]);
}

export function integrityPath(
  type: DocumentIntegrityType,
  id: number | string,
): string {
  const build = INTEGRITY_ENDPOINTS[type];
  if (!build) {
    throw new Error(`Document integrity is not available for "${type}".`);
  }
  return build(id);
}

export const integrityVerifyPath = (
  type: DocumentIntegrityType,
  id: number | string,
) => `${integrityPath(type, id)}verify/`;

export const integrityRetrySealPath = (
  type: DocumentIntegrityType,
  id: number | string,
) => `${integrityPath(type, id)}retry-seal/`;

export const leaveIntegrityPath = (id: number | string) =>
  integrityPath("leave", id);

export const VERIFY_UPLOAD_PATH = "/api/documents/verify-upload/";

export async function getDocumentIntegrity(
  type: DocumentIntegrityType,
  id: number | string,
): Promise<DocumentIntegrity> {
  const { data } = await api.get<ApiResponse<Raw>>(integrityPath(type, id));
  return normalizeIntegrity(unwrapApiData(data));
}

export async function verifyDocumentIntegrity(
  type: DocumentIntegrityType,
  id: number | string,
): Promise<DocumentIntegrity> {
  const { data } = await api.post<ApiResponse<Raw>>(
    integrityVerifyPath(type, id),
  );
  return normalizeIntegrity(unwrapApiData(data));
}

export async function retryDocumentSeal(
  type: DocumentIntegrityType,
  id: number | string,
): Promise<DocumentIntegrity> {
  const { data } = await api.post<ApiResponse<Raw>>(
    integrityRetrySealPath(type, id),
  );
  return normalizeIntegrity(unwrapApiData(data));
}

/** Leave shorthands, kept for existing callers. */
export const getLeaveIntegrity = (id: number | string) =>
  getDocumentIntegrity("leave", id);

export const verifyLeaveIntegrity = (id: number | string) =>
  verifyDocumentIntegrity("leave", id);

export const retryLeaveSeal = (id: number | string) =>
  retryDocumentSeal("leave", id);

export async function verifyDocumentUpload(
  file: File,
): Promise<VerifyUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<ApiResponse<Raw>>(VERIFY_UPLOAD_PATH, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return normalizeVerifyUpload(unwrapApiData(data));
}
