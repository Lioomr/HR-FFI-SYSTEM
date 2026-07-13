import type { ReactNode } from "react";
import { Tooltip } from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import type {
  NotificationDelivery,
  NotificationDeliveryStatus as DeliveryStatus,
} from "../../services/api/notificationsApi";
import { useI18n } from "../../i18n/useI18n";
import {
  DELIVERY_STATUS_COLOR,
  deliveryHint,
  deliveryLabel,
  orderDeliveries,
} from "./notificationDeliveryUtils";

function statusIcon(status: DeliveryStatus): ReactNode {
  switch (status) {
    case "sent":
      return <CheckCircleFilled />;
    case "failed":
      return <CloseCircleFilled />;
    case "pending":
      return <ClockCircleOutlined />;
    case "skipped":
    default:
      return <MinusCircleOutlined />;
  }
}

interface NotificationDeliveryStatusProps {
  deliveries?: NotificationDelivery[];
  /** Compact = smaller chips for the bell dropdown. */
  compact?: boolean;
}

/**
 * Row of non-interactive delivery chips (WhatsApp first, email fallback second).
 * Rendered inside the notification row button, so it is presentational only —
 * the row's `aria-label` carries the same information for screen readers.
 * Never renders raw provider errors; only safe status labels/hints.
 */
export default function NotificationDeliveryStatus({
  deliveries,
  compact,
}: NotificationDeliveryStatusProps) {
  const { t } = useI18n();
  const ordered = orderDeliveries(deliveries);
  if (ordered.length === 0) return null;

  return (
    <span
      className={`ffi-notif-delivery-row${compact ? " ffi-notif-delivery-row--compact" : ""}`}
    >
      {ordered.map((d, i) => {
        const color = DELIVERY_STATUS_COLOR[d.status] ?? DELIVERY_STATUS_COLOR.pending;
        const label = deliveryLabel(t, d.channel, d.status);
        const hint = deliveryHint(t, d.status);
        return (
          <Tooltip key={`${d.channel}-${i}`} title={hint}>
            <span
              className="ffi-notif-delivery"
              style={{ color, background: `${color}14` }}
              title={`${label} — ${hint}`}
            >
              <span className="ffi-notif-delivery__icon" aria-hidden="true">
                {statusIcon(d.status)}
              </span>
              {label}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}
