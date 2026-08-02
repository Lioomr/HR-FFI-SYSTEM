import { useAuthStore } from "../../auth/authStore";
import { useI18n } from "../../i18n/useI18n";
import type { NotificationDelivery } from "../../services/api/notificationsApi";
import {
  canViewDeliveryTechnicalDetails,
  deliveryLabel,
  orderDeliveries,
} from "./notificationDeliveryUtils";

interface Props {
  deliveries?: NotificationDelivery[];
}

/**
 * Admin-only, keyboard-accessible disclosure of per-channel delivery details.
 *
 * Rendered on the full inbox page *outside* the notification row button (so it
 * is independently focusable). Non-admins never see it. The `error` shown here
 * is the backend's single-line, privacy-filtered value — raw provider errors are
 * never exposed even to admins.
 */
export default function NotificationDeliveryAdminDetails({ deliveries }: Props) {
  const { t } = useI18n();
  const role = useAuthStore((s) => s.user?.role);

  const ordered = orderDeliveries(deliveries);
  if (ordered.length === 0 || !canViewDeliveryTechnicalDetails(role)) return null;

  return (
    <details className="ffi-notif-delivery-details">
      <summary className="ffi-notif-delivery-details__summary">
        {t("notifications.delivery.technicalDetails", "Delivery details (admin)")}
      </summary>
      <div className="ffi-notif-delivery-details__body">
        {ordered.map((d, i) => (
          <div key={`${d.channel}-${i}`} className="ffi-notif-delivery-details__row">
            <div className="ffi-notif-delivery-details__label">
              {deliveryLabel(t, d.channel, d.status)}
            </div>
            <dl className="ffi-notif-delivery-details__grid">
              {d.provider ? (
                <>
                  <dt>{t("notifications.delivery.provider", "Provider")}</dt>
                  <dd>{d.provider}</dd>
                </>
              ) : null}
              {typeof d.attempt_count === "number" ? (
                <>
                  <dt>{t("notifications.delivery.attempts", "Attempts")}</dt>
                  <dd className="ffi-notif-count">{d.attempt_count}</dd>
                </>
              ) : null}
              {d.provider_message_id ? (
                <>
                  <dt>{t("notifications.delivery.messageId", "Message ID")}</dt>
                  <dd className="ffi-notif-delivery-details__mono">
                    {d.provider_message_id}
                  </dd>
                </>
              ) : null}
              <dt>{t("notifications.delivery.detail", "Detail")}</dt>
              <dd>
                {d.error
                  ? d.error
                  : t("notifications.delivery.noError", "No error reported.")}
              </dd>
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
