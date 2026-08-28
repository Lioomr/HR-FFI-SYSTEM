import { useEffect, useState } from "react";
import { Switch, Typography, Alert, Button, Spin, Space } from "antd";
import {
  WhatsAppOutlined,
  MailOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import {
  getNotificationChannelPreferences,
  saveNotificationChannelPreferences,
  type NotificationChannelPreferences,
} from "../../services/api/notificationsApi";
import "./notifications.css";

const { Text } = Typography;

/**
 * User notification channel preferences.
 *
 * Backed by the real backend contract: the generic user-preference endpoint
 * (`/api/core/preferences/notifications/channels/`) which
 * `in_app_notifications/dispatcher.py` reads. The dispatcher combines these
 * preferences with the global `NOTIFICATION_*` settings, so a toggle here can
 * only *opt out* of a channel — it can never override a globally-disabled
 * channel, backend permissions, or a missing WhatsApp number.
 */
export default function NotificationPreferences() {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [prefs, setPrefs] = useState<NotificationChannelPreferences>({
    whatsapp_enabled: true,
    email_enabled: true,
  });
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    setSaved(false);
    try {
      const res = await getNotificationChannelPreferences();
      if (res.status === "success") {
        setPrefs(res.data);
        setDirty(false);
      } else {
        setLoadError(
          res.message ||
            t(
              "notifications.preferences.loadError",
              "Couldn't load preferences.",
            ),
        );
      }
    } catch (err) {
      const message =
        (err as { message?: string })?.message ||
        t("notifications.preferences.loadError", "Couldn't load preferences.");
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<NotificationChannelPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setSaved(false);
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await saveNotificationChannelPreferences(prefs);
      if (res.status === "success") {
        setPrefs(res.data);
        setDirty(false);
        setSaved(true);
      } else {
        setSaveError(
          res.message ||
            t(
              "notifications.preferences.saveError",
              "Couldn't save preferences.",
            ),
        );
      }
    } catch (err) {
      const message =
        (err as { message?: string })?.message ||
        t("notifications.preferences.saveError", "Couldn't save preferences.");
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center" }}>
        <Spin />
        <div style={{ marginTop: 12, color: "#94a3b8" }}>
          {t("notifications.loading", "Loading…")}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: "8px 0" }}>
        <Alert
          type="warning"
          showIcon
          title={t(
            "notifications.preferences.loadError",
            "Couldn't load preferences.",
          )}
          description={loadError}
        />
        <Button style={{ marginTop: 12 }} onClick={() => void load()}>
          {t("notifications.retry", "Retry")}
        </Button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t(
        "notifications.preferences.title",
        "Notification preferences",
      )}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Alert
        type="info"
        showIcon
        title={t(
          "notifications.preferences.explanationTitle",
          "How you're notified",
        )}
        description={
          <span style={{ textWrap: "pretty" } as React.CSSProperties}>
            {t(
              "notifications.preferences.explanation",
              "WhatsApp is tried first. Email is used only if WhatsApp fails or is unavailable.",
            )}
          </span>
        }
        style={{ borderRadius: 12 }}
      />

      <div className="ffi-notif-pref-row">
        <span
          className="ffi-notif-pref-row__icon"
          style={{ color: "#22c55e", background: "rgba(34,197,94,0.12)" }}
          aria-hidden="true"
        >
          <WhatsAppOutlined />
        </span>
        <div className="ffi-notif-pref-row__body">
          <Text strong style={{ display: "block" }}>
            {t(
              "notifications.preferences.whatsappLabel",
              "WhatsApp notifications",
            )}
          </Text>
          <Text
            type="secondary"
            style={
              { fontSize: 12.5, textWrap: "pretty" } as React.CSSProperties
            }
          >
            {t(
              "notifications.preferences.whatsappHelp",
              "Receive notifications on WhatsApp when a valid number is on file.",
            )}
          </Text>
        </div>
        <Switch
          checked={prefs.whatsapp_enabled}
          onChange={(checked) => update({ whatsapp_enabled: checked })}
          aria-label={t(
            "notifications.preferences.whatsappLabel",
            "WhatsApp notifications",
          )}
        />
      </div>

      <div className="ffi-notif-pref-row">
        <span
          className="ffi-notif-pref-row__icon"
          style={{ color: "#3b82f6", background: "rgba(59,130,246,0.12)" }}
          aria-hidden="true"
        >
          <MailOutlined />
        </span>
        <div className="ffi-notif-pref-row__body">
          <Text strong style={{ display: "block" }}>
            {t("notifications.preferences.emailLabel", "Email fallback")}
          </Text>
          <Text
            type="secondary"
            style={
              { fontSize: 12.5, textWrap: "pretty" } as React.CSSProperties
            }
          >
            {t(
              "notifications.preferences.emailHelp",
              "Send an email only when WhatsApp fails or is unavailable.",
            )}
          </Text>
        </div>
        <Switch
          checked={prefs.email_enabled}
          onChange={(checked) => update({ email_enabled: checked })}
          aria-label={t(
            "notifications.preferences.emailLabel",
            "Email fallback",
          )}
        />
      </div>

      <Text
        type="secondary"
        style={{ fontSize: 12, textWrap: "pretty" } as React.CSSProperties}
      >
        {t(
          "notifications.preferences.note",
          "Your organization's settings may still apply. Some critical messages are always sent.",
        )}
      </Text>

      {saveError && (
        <Alert
          type="error"
          showIcon
          title={t(
            "notifications.preferences.saveError",
            "Couldn't save preferences.",
          )}
          description={saveError}
          style={{ borderRadius: 12 }}
        />
      )}
      {saved && !dirty && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          title={t("notifications.preferences.saved", "Preferences saved.")}
          style={{ borderRadius: 12 }}
        />
      )}

      <Space>
        <Button
          type="primary"
          loading={saving}
          disabled={!dirty}
          onClick={() => void save()}
        >
          {saving
            ? t("notifications.preferences.saving", "Saving…")
            : t("notifications.preferences.save", "Save preferences")}
        </Button>
      </Space>
    </div>
  );
}
