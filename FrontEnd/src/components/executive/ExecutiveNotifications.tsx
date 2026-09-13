import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";
import {
  listNotifications,
  type NotificationDto,
} from "../../services/api/notificationsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useNotificationStore } from "../../stores/notificationStore";
import NotificationItem from "../notifications/NotificationItem";
import { useNotificationNavigate } from "../notifications/notificationUrl";

export default function ExecutiveNotifications() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const select = useNotificationNavigate();
  const recent = useNotificationStore((s) => s.recent);
  const scope = useNotificationStore((s) => s.scopeKey);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setCount(null);
    setItems([]);
    setError(false);
    void listNotifications({ unread: true, page: 1, page_size: 3 })
      .then((response) => {
        if (isApiError(response)) throw new Error(response.message);
        if (active) {
          setItems(response.data.items);
          setCount(response.data.count);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [recent, scope, retry]);
  return (
    <Card
      title={`${t("notifications.title")}${count === null ? "" : ` · ${count} ${t("notifications.unread")}`}`}
      extra={
        <Button onClick={() => navigate("/notifications")}>
          {t("common.viewAll")}
        </Button>
      }
    >
      {error ? (
        <Alert
          type="warning"
          message={t("executive.notificationsFailed")}
          action={
            <Button onClick={() => setRetry((n) => n + 1)}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : count === null ? (
        <Spin />
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("executive.noUnread")}
        />
      ) : (
        items.map((item) => (
          <NotificationItem
            key={item.id}
            notification={item}
            onSelect={(notification) => select(notification.action_url)}
          />
        ))
      )}
    </Card>
  );
}
