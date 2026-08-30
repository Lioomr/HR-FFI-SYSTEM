import { Tag } from "antd";

import type { JobOfferApprovalStatus } from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";

/**
 * The CEO approval track, shown next to the delivery status everywhere an offer
 * appears. Keeping the two chips visually distinct stops "Approved" (by the
 * CEO) from being read as "Accepted" (by the candidate).
 */
const TONE: Record<
  JobOfferApprovalStatus,
  { background: string; border: string; color: string }
> = {
  draft: { background: "#f8fafc", border: "#cbd5e1", color: "#475569" },
  pending_ceo: { background: "#fefce8", border: "#fde68a", color: "#a16207" },
  approved: { background: "#ecfdf5", border: "#a7f3d0", color: "#047857" },
  changes_requested: {
    background: "#fff7ed",
    border: "#fed7aa",
    color: "#c2410c",
  },
  rejected: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
};

export default function JobOfferApprovalStatusTag({
  status,
  fallbackLabel,
  size = "default",
}: {
  status: JobOfferApprovalStatus;
  /** `approval_status_label` from the backend, used when the key is untranslated. */
  fallbackLabel?: string;
  size?: "default" | "large";
}) {
  const { t } = useI18n();
  const tone = TONE[status] || TONE.draft;
  const label = t(
    `jobOffers.approval.status.${status}`,
    fallbackLabel || status,
  );

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
