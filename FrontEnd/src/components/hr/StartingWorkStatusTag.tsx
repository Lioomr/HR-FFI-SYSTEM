import { Tag } from "antd";

import type { StartingWorkAcknowledgmentStatus } from "../../services/api/startingWorkAcknowledgmentsApi";
import { useI18n } from "../../i18n/useI18n";

/**
 * HR verification state of a starting-work acknowledgement.
 *
 * Pending is warned in amber rather than neutral grey: while it sits there the
 * employee's first attendance is held back from payroll.
 */
const TONE: Record<
  StartingWorkAcknowledgmentStatus,
  { background: string; border: string; color: string }
> = {
  pending_hr: { background: "#fefce8", border: "#fde68a", color: "#a16207" },
  approved: { background: "#ecfdf5", border: "#a7f3d0", color: "#047857" },
  rejected: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
};

export default function StartingWorkStatusTag({
  status,
  fallbackLabel,
  size = "default",
}: {
  status: StartingWorkAcknowledgmentStatus;
  /** `status_label` from the backend, used when the key is untranslated. */
  fallbackLabel?: string;
  size?: "default" | "large";
}) {
  const { t } = useI18n();
  const tone = TONE[status] || TONE.pending_hr;
  const label = t(`startingWork.status.${status}`, fallbackLabel || status);

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
