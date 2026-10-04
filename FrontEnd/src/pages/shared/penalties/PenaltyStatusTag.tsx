import type { ReactNode } from "react";
import { Tag } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../../i18n/useI18n";
import type { PenaltyStatus } from "../../../services/api/penaltiesApi";

// Icon + text so the status never relies on colour alone.
const styles: Record<PenaltyStatus, { color: string; icon: ReactNode }> = {
  pending_hr_mark: { color: "gold", icon: <ClockCircleOutlined /> },
  issued: { color: "blue", icon: <ExclamationCircleOutlined /> },
  disputed: { color: "orange", icon: <MessageOutlined /> },
  waived: { color: "green", icon: <CheckCircleOutlined /> },
  applied: { color: "purple", icon: <WalletOutlined /> },
};

export default function PenaltyStatusTag({
  status,
}: {
  status: PenaltyStatus;
}) {
  const { t } = useI18n();
  const style = styles[status];
  return (
    <Tag color={style?.color ?? "default"} icon={style?.icon}>
      {t(`penalties.status.${status}`, undefined, status)}
    </Tag>
  );
}
