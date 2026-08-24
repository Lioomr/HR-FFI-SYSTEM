import { Tag } from "antd";

import type { HiringRequestStatus } from "../../services/api/hiringRequestsApi";
import { useI18n } from "../../i18n/useI18n";

/**
 * One visual vocabulary for hiring-request status across the HR list, the HR
 * detail header and the CEO inbox, so a "Submitted" chip reads the same
 * wherever it appears.
 */
const TONE: Record<HiringRequestStatus, { background: string; border: string; color: string }> = {
  draft: { background: "#f8fafc", border: "#cbd5e1", color: "#475569" },
  submitted: { background: "#fff7ed", border: "#fed7aa", color: "#c2410c" },
  approved: { background: "#ecfdf5", border: "#a7f3d0", color: "#047857" },
  rejected: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
  cancelled: { background: "#f1f5f9", border: "#cbd5e1", color: "#64748b" },
  converted: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
};

export default function HiringRequestStatusTag({
  status,
  fallbackLabel,
  size = "default",
}: {
  status: HiringRequestStatus;
  /** `status_label` from the backend, used when the key is not translated. */
  fallbackLabel?: string;
  size?: "default" | "large";
}) {
  const { t } = useI18n();
  const tone = TONE[status] || TONE.draft;

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
      {t(`hiringRequests.status.${status}`, fallbackLabel || status)}
    </Tag>
  );
}
