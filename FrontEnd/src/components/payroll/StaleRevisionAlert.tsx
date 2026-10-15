import { Alert, Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";

/**
 * Shown after a 409 stale_revision. The page has already stopped and reloaded
 * the latest data; the user re-applies their change and retries by hand.
 * Payroll mutations are never retried automatically.
 */
export default function StaleRevisionAlert({
  message,
  onReload,
  onClose,
}: {
  /** The API's own (localised) message, when it sent one. */
  message?: string;
  onReload?: () => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Alert
      type="warning"
      showIcon
      role="alert"
      message={message || t("payroll.ui.staleTitle")}
      description={t("payroll.ui.staleDescription")}
      closable={Boolean(onClose)}
      onClose={onClose}
      action={
        onReload ? (
          <Button size="small" icon={<ReloadOutlined />} onClick={onReload}>
            {t("payroll.ui.reload")}
          </Button>
        ) : undefined
      }
      style={{ marginBottom: 16 }}
    />
  );
}
