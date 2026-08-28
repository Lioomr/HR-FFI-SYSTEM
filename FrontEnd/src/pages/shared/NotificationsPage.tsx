import { useEffect, useState } from "react";
import {
  Card,
  Segmented,
  Button,
  Pagination,
  Spin,
  Empty,
  Result,
  Space,
  Typography,
  Drawer,
} from "antd";
import {
  CheckOutlined,
  ReloadOutlined,
  InboxOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import {
  useNotificationStore,
  type NotificationFilter,
} from "../../stores/notificationStore";
import type { NotificationDto } from "../../services/api/notificationsApi";
import NotificationItem from "../../components/notifications/NotificationItem";
import NotificationDeliveryAdminDetails from "../../components/notifications/NotificationDeliveryAdminDetails";
import NotificationPreferences from "../../components/notifications/NotificationPreferences";
import { useNotificationNavigate } from "../../components/notifications/notificationUrl";
import "../../components/notifications/notifications.css";

const { Title, Text } = Typography;

/**
 * Full notification inbox — available to every authenticated role.
 * Filters (all/unread), pagination, mark-read actions, deep links, and the
 * full set of loading / empty / error / disconnected states.
 */
export default function NotificationsPage() {
  const { t, direction } = useI18n();
  const navigateToNotification = useNotificationNavigate();
  const [prefsOpen, setPrefsOpen] = useState(false);

  const items = useNotificationStore((s) => s.items);
  const loading = useNotificationStore((s) => s.listLoading);
  const error = useNotificationStore((s) => s.listError);
  const page = useNotificationStore((s) => s.page);
  const pageSize = useNotificationStore((s) => s.pageSize);
  const count = useNotificationStore((s) => s.count);
  const filter = useNotificationStore((s) => s.filter);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const connection = useNotificationStore((s) => s.connection);
  const fetchList = useNotificationStore((s) => s.fetchList);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  useEffect(() => {
    void fetchList({ page: 1, filter });
    void fetchUnreadCount();
    // Load on mount only; filter changes are handled explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = (value: NotificationFilter) => {
    void fetchList({ page: 1, filter: value });
  };

  const handlePage = (nextPage: number) => {
    void fetchList({ page: nextPage, filter });
  };

  const handleRefresh = () => {
    void fetchList({ page, filter });
    void fetchUnreadCount();
  };

  const handleSelect = (n: NotificationDto) => {
    void markRead(n.id);
    navigateToNotification(n.action_url);
  };

  const showConnState =
    connection === "connecting" || connection === "reconnecting";
  const connLabel =
    connection === "connecting"
      ? t("notifications.connecting", "Connecting…")
      : t(
          "notifications.pollingFallback",
          "Reconnecting… showing latest updates",
        );

  const body = () => {
    if (loading && items.length === 0) {
      return (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <Spin size="large" />
          <div style={{ marginTop: 14, color: "#94a3b8" }}>
            {t("notifications.loading", "Loading…")}
          </div>
        </div>
      );
    }

    if (error && items.length === 0) {
      return (
        <Result
          status="warning"
          title={t("notifications.loadError", "Couldn't load notifications.")}
          subTitle={error}
          extra={
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
            >
              {t("notifications.retry", "Retry")}
            </Button>
          }
        />
      );
    }

    if (items.length === 0) {
      return (
        <Empty
          image={<InboxOutlined style={{ fontSize: 48, color: "#cbd5e1" }} />}
          styles={{ image: { height: 56 } }}
          description={
            <span style={{ color: "#94a3b8" }}>
              {filter === "unread"
                ? t("notifications.emptyUnread", "No unread notifications")
                : t("notifications.empty", "You're all caught up")}
            </span>
          }
          style={{ padding: "56px 0" }}
        />
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((n) => (
          <div
            key={n.id}
            className={`ffi-notif-page-row${
              n.is_read ? "" : " ffi-notif-page-row--unread"
            }`}
          >
            <NotificationItem notification={n} onSelect={handleSelect} />
            <NotificationDeliveryAdminDetails deliveries={n.deliveries} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <Card
        styles={{ body: { padding: 0 } }}
        style={{ borderRadius: 16, overflow: "hidden" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "16px 18px 12px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Title
              level={4}
              style={{ margin: 0, textWrap: "balance" } as React.CSSProperties}
            >
              {t("notifications.title", "Notifications")}
            </Title>
            {showConnState && (
              <span className="ffi-notif-conn" style={{ marginTop: 4 }}>
                <span className="ffi-notif-conn__dot ffi-notif-conn__dot--pulsing" />
                {connLabel}
              </span>
            )}
          </div>

          <Space wrap>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setPrefsOpen(true)}
              aria-label={t(
                "notifications.preferences.open",
                "Notification preferences",
              )}
            >
              {t("notifications.preferences.button", "Preferences")}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading && items.length > 0}
            >
              {t("notifications.refresh", "Refresh")}
            </Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              disabled={unreadCount === 0}
              onClick={() => markAllRead()}
            >
              {t("notifications.markAllRead", "Mark all as read")}
            </Button>
          </Space>
        </div>

        <div style={{ padding: "0 18px 12px" }}>
          <Segmented
            value={filter}
            onChange={(v) => handleFilter(v as NotificationFilter)}
            options={[
              { label: t("notifications.filter.all", "All"), value: "all" },
              {
                label:
                  unreadCount > 0
                    ? `${t("notifications.filter.unread", "Unread")} (${unreadCount})`
                    : t("notifications.filter.unread", "Unread"),
                value: "unread",
              },
            ]}
          />
        </div>

        <div style={{ padding: "0 12px 8px", minHeight: 200 }}>{body()}</div>

        {count > pageSize && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "12px 16px 18px",
              borderTop: "1px solid rgba(226,232,240,0.7)",
            }}
          >
            <Pagination
              current={page}
              pageSize={pageSize}
              total={count}
              showSizeChanger={false}
              onChange={handlePage}
            />
          </div>
        )}
      </Card>

      <Text
        type="secondary"
        style={{
          display: "block",
          textAlign: "center",
          marginTop: 12,
          fontSize: 12,
        }}
      >
        {t(
          "notifications.retentionNote",
          "Notifications are kept for 90 days.",
        )}
      </Text>

      <Drawer
        title={t("notifications.preferences.title", "Notification preferences")}
        placement={direction === "rtl" ? "left" : "right"}
        rootClassName="ffi-notif-pref-drawer"
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        destroyOnHidden
      >
        {prefsOpen && <NotificationPreferences />}
      </Drawer>
    </div>
  );
}
