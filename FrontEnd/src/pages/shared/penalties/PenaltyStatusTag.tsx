import { Tag } from "antd";
import { useI18n } from "../../../i18n/useI18n";
import type { PenaltyStatus } from "../../../services/api/penaltiesApi";

const colors: Record<PenaltyStatus, string> = {
  pending_hr_mark: "gold",
  issued: "blue",
  disputed: "orange",
  upheld: "blue",
  waived: "green",
  applied: "purple",
};

export default function PenaltyStatusTag({
  status,
}: {
  status: PenaltyStatus;
}) {
  const { t } = useI18n();
  return (
    <Tag color={colors[status] ?? "default"}>
      {t(`penalties.status.${status}`, undefined, status)}
    </Tag>
  );
}
