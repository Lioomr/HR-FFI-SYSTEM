import { CV_ACCEPT, MAX_CV_SIZE_BYTES } from "../../../services/api/hiringRequestsApi";

export type CvRejectionReason = "type" | "size";

/**
 * Mirrors the backend's CV allow-list so a bad pick is refused before the file
 * is uploaded. The backend still re-checks extension, MIME and file signature;
 * this only spares the user a round trip.
 */
export function isAllowedCvFile(file: { name?: string; size?: number }): {
  ok: boolean;
  reason?: CvRejectionReason;
} {
  const name = (file.name || "").toLowerCase();
  const allowed = CV_ACCEPT.split(",").some((extension) => name.endsWith(extension));
  if (!allowed) return { ok: false, reason: "type" };
  if ((file.size || 0) > MAX_CV_SIZE_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}
