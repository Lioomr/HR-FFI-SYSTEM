import { useState } from "react";
import { Badge, Button, Popover, Tooltip, Spin, Empty } from "antd";
import { BellOutlined, CheckOutlined, InboxOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";
import { useNotificationStore } from "../../stores/notificationStore";
import type { NotificationDto } from "../../services/api/notificationsApi";
import NotificationItem from "./NotificationItem";
import { useNotificationNavigate } from "./notificationUrl";
import "./notifications.css";

interface NotificationBellProps {
  isMobile?: boolean;
  /** Muted icon colour taken from the active organization theme. */
  color?: string;
  /** Soft background taken from the active organization theme. */
  background?: string;
}

/**
 * Header notification bell: real unread badge + compact recent dropdown.
 * Backed by the shared notification store, so it stays in sync with the
 * full inbox page and the authenticated REST polling runtime.
 */
export default function NotificationBell({
  isMobile,
  color = "#64748b",
  background = "rgba(249,115,22,0.10)",
}: NotificationBellProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const navigateToNotification = useNotificationNavigate();
  const [open, setOpen] = useState(false);

  const recent = useNotificationStore((s) => s.recent);
  const loading = useNotificationStore((s) => s.recentLoading);
  const error = useNotificationStore((s) => s.recentError);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const connection = useNotificationStore((s) => s.connection);
  const fetchRecent = useNotificationStore((s) => s.fetchRecent);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  const bellLabel = t("notifications.bellLabel", "Notifications");
  const ariaLabel =
    unreadCount > 0
      ? t(
          "notifications.bellLabelUnread",
          "Notifications, {count} unread",
        ).replace("{count}", String(unreadCount))
      : bellLabel;

  const handleSelect = (n: NotificationDto) => {
    void markRead(n.id);
    setOpen(false);
    navigateToNotification(n.action_url);
  };

  const showConnState =
    connection === "connecting" || connection === "reconnecting";
  const connLabel =
    connection === "connecting"
      ? t("notifications.connecting", "Connecting…")
      : t("notifications.reconnecting", "Reconnecting…");

  const panel = (
    <div className="ffi-notif-panel" role="dialog" aria-label={bellLabel}>
      <div className="ffi-notif-panel__header">
        <h3 className="ffi-notif-panel__title">{bellLabel}</h3>
        <Button
          type="link"
          size="small"
          icon={<CheckOutlined />}
          disabled={unreadCount === 0}
          onClick={() => markAllRead()}
          style={{ padding: 0, height: "auto", fontWeight: 600 }}
        >
          {t("notifications.markAllRead", "Mark all as read")}
        </Button>
      </div>

      {showConnState && (
        <div style={{ padding: "0 16px 8px" }}>
          <span className="ffi-notif-conn">
            <span className="ffi-notif-conn__dot ffi-notif-conn__dot--pulsing" />
            {connLabel}
          </span>
        </div>
      )}

      <div className="ffi-notif-panel__list">
        {loading && recent.length === 0 ? (
          <div style={{ padding: "28px 0", textAlign: "center" }}>
            <Spin />
            <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 12.5 }}>
              {t("notifications.loading", "Loading…")}
            </div>
          </div>
        ) : error && recent.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            <div style={{ color: "#64748b", fontSize: 13, marginBottom: 8 }}>
              {t("notifications.loadError", "Couldn't load notifications.")}
            </div>
            <Button size="small" onClick={() => fetchRecent()}>
              {t("notifications.retry", "Retry")}
            </Button>
          </div>
        ) : recent.length === 0 ? (
          <Empty
            image={<InboxOutlined style={{ fontSize: 34, color: "#cbd5e1" }} />}
            styles={{ image: { height: 40 } }}
            description={
              <span style={{ color: "#94a3b8", fontSize: 13 }}>
                {t("notifications.empty", "You're all caught up")}
              </span>
            }
            style={{ padding: "22px 0" }}
          />
        ) : (
          recent.map((n, i) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onSelect={handleSelect}
              animationIndex={i}
            />
          ))
        )}
      </div>

      <div className="ffi-notif-panel__footer">
        <Button
          type="text"
          block
          onClick={() => {
            setOpen(false);
            navigate("/notifications");
          }}
          style={{ fontWeight: 600, color: "#f97316" }}
        >
          {t("notifications.viewAll", "View all notifications")}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      content={panel}
      rootClassName="ffi-notif-popover"
    >
      <Tooltip title={!open ? bellLabel : ""}>
        <Badge
          count={unreadCount}
          overflowCount={99}
          showZero={false}
          size="small"
          classNames={{ indicator: "ffi-notif-count" }}
        >
          <Button
            aria-label={ariaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            icon={<BellOutlined />}
            type="text"
            style={{
              width: isMobile ? 30 : 36,
              height: isMobile ? 30 : 36,
              borderRadius: 10,
              color,
              background,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
