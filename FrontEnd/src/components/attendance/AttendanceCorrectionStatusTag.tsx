import { Tag } from "antd";
import type { AttendanceCorrectionStatus } from "../../services/api/attendanceCorrectionsApi";
import { useI18n } from "../../i18n/useI18n";

const STATUS_COLOR: Record<AttendanceCorrectionStatus, string> = {
  draft: "default",
  pending_manager: "orange",
  pending_hr: "gold",
  approved: "green",
  rejected: "red",
  cancelled: "default",
};

const STATUS_LABEL_KEY: Record<AttendanceCorrectionStatus, string> = {
  draft: "attendanceCorrections.status.draft",
  pending_manager: "attendanceCorrections.status.pendingManager",
  pending_hr: "attendanceCorrections.status.pendingHr",
  approved: "attendanceCorrections.status.approved",
  rejected: "attendanceCorrections.status.rejected",
  cancelled: "attendanceCorrections.status.cancelled",
};

export default function AttendanceCorrectionStatusTag({
  status,
}: {
  status: AttendanceCorrectionStatus;
}) {
  const { t } = useI18n();
  const color = STATUS_COLOR[status] || "default";
  const labelKey = STATUS_LABEL_KEY[status];
  const label = labelKey ? t(labelKey) : status;
  return (
    <Tag color={color} style={{ borderRadius: 999, paddingInline: 10, fontWeight: 600 }}>
      {label}
    </Tag>
  );
}
