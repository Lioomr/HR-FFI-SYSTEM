import { Tag } from "antd";
import type { NotificationDto } from "../../services/api/notificationsApi";
import { useI18n } from "../../i18n/useI18n";
import {
  categoryLabelKey,
  formatAbsoluteTime,
  formatRelativeTime,
  getCategoryColor,
  getCategoryIcon,
} from "./notificationMeta";
import NotificationDeliveryStatus from "./NotificationDeliveryStatus";
import { summarizeDeliveries } from "./notificationDeliveryUtils";

interface NotificationItemProps {
  notification: NotificationDto;
  onSelect: (notification: NotificationDto) => void;
  /** Adds the staggered entry animation class (used in the bell dropdown). */
  animationIndex?: number;
}

/**
 * Presentational row shared by the header bell dropdown and the inbox page.
 * Renders category, title, message, relative + absolute time, and unread state.
 * Rendered as a real <button> for keyboard and screen-reader accessibility.
 */
export default function NotificationItem({
  notification,
  onSelect,
  animationIndex,
}: NotificationItemProps) {
  const { t, language } = useI18n();

  const color = getCategoryColor(notification.category);
  const relative = formatRelativeTime(notification.created_at, language);
  const absolute = formatAbsoluteTime(notification.created_at, language);
  const categoryLabel = t(
    categoryLabelKey(notification.category),
    notification.category || t("notifications.category.general", "General"),
  );

  const unread = !notification.is_read;
  const deliverySummary = summarizeDeliveries(t, notification.deliveries);
  const ariaLabel = `${categoryLabel}: ${notification.title}. ${
    unread
      ? t("notifications.unread", "Unread")
      : t("notifications.read", "Read")
  }. ${absolute}${deliverySummary ? `. ${deliverySummary}` : ""}`;

  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      aria-label={ariaLabel}
      className={`ffi-notif-item${unread ? " ffi-notif-item--unread" : ""}${
        animationIndex != null ? " ffi-notif-enter" : ""
      }`}
      style={
        animationIndex != null
          ? { animationDelay: `${Math.min(animationIndex, 8) * 28}ms` }
          : undefined
      }
    >
      <span
        className="ffi-notif-item__icon"
        style={{ color, background: `${color}1a` }}
        aria-hidden="true"
      >
        {getCategoryIcon(notification.category)}
      </span>

      <span className="ffi-notif-item__body">
        <span className="ffi-notif-item__title">{notification.title}</span>
        {notification.message ? (
          <span className="ffi-notif-item__message">
            {notification.message}
          </span>
        ) : null}
        <span className="ffi-notif-item__meta">
          <Tag
            variant="filled"
            style={{
              margin: 0,
              color,
              background: `${color}14`,
              fontSize: 10.5,
              lineHeight: "16px",
              padding: "0 7px",
            }}
          >
            {categoryLabel}
          </Tag>
          <time
            className="ffi-notif-time"
            dateTime={notification.created_at}
            title={absolute}
          >
            {relative}
          </time>
        </span>
        <NotificationDeliveryStatus
          deliveries={notification.deliveries}
          compact
        />
      </span>

      {unread ? (
        <span
          className="ffi-notif-item__dot"
          aria-hidden="true"
          style={{ background: color }}
        />
      ) : null}
    </button>
  );
}
