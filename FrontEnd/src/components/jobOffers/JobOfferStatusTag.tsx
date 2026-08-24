import { Tag } from "antd";

import type { JobOfferStatus } from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";

/**
 * One visual vocabulary for offer status across the HR list, the detail header
 * and the candidate-facing page, so a "Sent" chip reads the same everywhere.
 */
const TONE: Record<JobOfferStatus, { background: string; border: string; color: string }> = {
  draft: { background: "#f8fafc", border: "#cbd5e1", color: "#475569" },
  sent: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
  accepted: { background: "#ecfdf5", border: "#a7f3d0", color: "#047857" },
  rejected: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
  expired: { background: "#fff7ed", border: "#fed7aa", color: "#c2410c" },
  cancelled: { background: "#f1f5f9", border: "#cbd5e1", color: "#64748b" },
};

export default function JobOfferStatusTag({
  status,
  fallbackLabel,
  size = "default",
}: {
  status: JobOfferStatus;
  /** `status_label` from the backend, used when the key is not translated. */
  fallbackLabel?: string;
  size?: "default" | "large";
}) {
  const { t } = useI18n();
  const tone = TONE[status] || TONE.draft;
  const label = t(`jobOffers.status.${status}`, fallbackLabel || status);

  return (
    <Tag
      style={{
        margin: 0,
        borderRadius: 999,
        fontWeight: 700,
        paddingInline: size === "large" ? 14 : 10,
        paddingBlock: size === "large" ? 3 : 1,
        fontSize: size === "large" ? 13 : 12,
        background: tone.background,
        borderColor: tone.border,
        color: tone.color,
      }}
    >
      {label}
    </Tag>
  );
}
