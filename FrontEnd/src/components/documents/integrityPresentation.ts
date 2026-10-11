import { getHttpStatus } from "../../services/api/httpErrors";
import type {
  DocumentIntegrity,
  IntegrityStatus,
} from "../../services/api/documentIntegrityApi";

export type IntegrityTone = "success" | "warning" | "error" | "neutral";

export interface IntegrityPresentation {
  tone: IntegrityTone;
  /** Ant Design Tag color for the status chip. */
  tagColor: "success" | "warning" | "error" | "default";
  labelKey: string;
  helpKey: string;
}

const TONE_BY_STATUS: Record<IntegrityStatus, IntegrityTone> = {
  signed_valid: "success",
  sealed_valid: "success",
  frozen_valid: "success",
  seal_pending: "warning",
  seal_failed: "warning",
  tampered: "error",
  missing_file: "error",
  not_frozen: "neutral",
};

const TAG_BY_TONE: Record<IntegrityTone, IntegrityPresentation["tagColor"]> = {
  success: "success",
  warning: "warning",
  error: "error",
  neutral: "default",
};

/**
 * `signingMode` "hash_only" (warning and late notices): the backend only
 * compares the upload with the hash stored at issuance; there is no locked
 * copy, seal or signature. A match then reads "Hash verified, not signed"
 * instead of "Locked, unchanged"; every other status (tampered stays red)
 * keeps its usual presentation.
 */
export function integrityPresentation(
  status: IntegrityStatus,
  signingMode?: string | null,
): IntegrityPresentation {
  const tone = TONE_BY_STATUS[status] ?? "neutral";
  if (signingMode === "hash_only" && status === "frozen_valid") {
    return {
      tone,
      tagColor: TAG_BY_TONE[tone],
      labelKey: "documentIntegrity.status.hash_verified",
      helpKey: "documentIntegrity.statusHelp.hash_verified",
    };
  }
  return {
    tone,
    tagColor: TAG_BY_TONE[tone],
    labelKey: `documentIntegrity.status.${status}`,
    helpKey: `documentIntegrity.statusHelp.${status}`,
  };
}

/** Seal is cryptographically valid but chains to the internal CA. */
export function hasUntrustedRoot(integrity: DocumentIntegrity): boolean {
  return (
    integrity.seal.present &&
    integrity.seal.valid !== false &&
    integrity.seal.trust === "untrusted_root"
  );
}

export function canRetrySealFor(status: IntegrityStatus): boolean {
  return status === "seal_failed" || status === "seal_pending";
}

export function shortHash(hash: string | null, size = 12): string {
  if (!hash) return "-";
  return hash.length <= size * 2
    ? hash
    : `${hash.slice(0, size)}…${hash.slice(-6)}`;
}

/**
 * The PDF endpoint answers 409 when a frozen copy exists but is missing or
 * fails its hash; it never falls back to a fresh render in that case.
 */
export function isDocumentBlocked(err: unknown): boolean {
  return getHttpStatus(err) === 409;
}
