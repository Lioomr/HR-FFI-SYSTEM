import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Tag } from "antd";
import type { ReactNode } from "react";

import { useI18n } from "../../i18n/useI18n";
import type { AnnualLeavePaymentStatus } from "../../services/api/annualLeavePaymentsApi";

/**
 * One status pill for every Annual Leave settlement screen, so one status
 * always reads the same way wherever it appears.
 *
 * `carried_forward` deliberately gets its own tone and wording: the days moved
 * into the next contract cycle, nothing was paid.
 */

const STATUS_PRESETS: Record<
  AnnualLeavePaymentStatus,
  { color: string; icon: ReactNode; labelKey: string }
> = {
  pending_hr: {
    color: "gold",
    icon: <ClockCircleOutlined aria-hidden />,
    labelKey: "annualPayment.status.pendingHr",
  },
  pending_ceo: {
    color: "orange",
    icon: <ClockCircleOutlined aria-hidden />,
    labelKey: "annualPayment.status.pendingCeo",
  },
  approved: {
    color: "green",
    icon: <CheckCircleOutlined aria-hidden />,
    labelKey: "annualPayment.status.approved",
  },
  rejected: {
    color: "red",
    icon: <CloseCircleOutlined aria-hidden />,
    labelKey: "annualPayment.status.rejected",
  },
  carried_forward: {
    color: "blue",
    icon: <SwapOutlined aria-hidden />,
    labelKey: "annualPayment.status.carriedForward",
  },
};

export default function AnnualLeavePaymentStatusTag({
  status,
}: {
  status: AnnualLeavePaymentStatus;
}) {
  const { t } = useI18n();
  const preset = STATUS_PRESETS[status];
  if (!preset) {
    return (
      <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{status}</Tag>
    );
  }
  return (
    <Tag
      color={preset.color}
      icon={preset.icon}
      style={{
        marginInlineEnd: 0,
        borderRadius: 999,
        paddingInline: 10,
        fontWeight: 600,
      }}
    >
      {t(preset.labelKey)}
    </Tag>
  );
}
