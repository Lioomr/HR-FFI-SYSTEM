import { useEffect, useState } from "react";
import { Alert, Form, Input, Modal, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";

const { Paragraph } = Typography;

/**
 * The one rejection dialog used across the CEO area.
 *
 * A rejection always carries a written reason, so the comment is required and
 * validated inline before the request is sent. Ant Design's Modal traps focus
 * and restores it on close; `destroyOnHidden` keeps the field from retaining a
 * previous request's text.
 */
export default function RejectReasonModal({
  open,
  title,
  subject,
  confirmText,
  loading = false,
  errorMessage,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  /** Who/what is being rejected, shown above the field. */
  subject?: string;
  confirmText?: string;
  loading?: boolean;
  /** Server-side failure, shown under the field so the text is not lost. */
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (reason: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setFieldError(null);
    }
  }, [open]);

  const handleOk = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setFieldError(t("ceo.approvals.rejectReasonRequired"));
      return;
    }
    setFieldError(null);
    await onSubmit(trimmed);
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={confirmText ?? t("common.reject")}
      okButtonProps={{
        danger: true,
        loading,
        "aria-label": confirmText ?? t("common.reject"),
      }}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: loading }}
      onOk={handleOk}
      onCancel={() => {
        if (loading) return;
        onCancel();
      }}
      closable={!loading}
      maskClosable={!loading}
      destroyOnHidden
    >
      {subject && (
        <Paragraph style={{ marginBottom: 12 }} strong>
          {subject}
        </Paragraph>
      )}
      <Alert
        type="warning"
        showIcon
        message={t("ceo.approvals.rejectWarning")}
        style={{ marginBottom: 16, borderRadius: 10 }}
      />
      <Form layout="vertical">
        <Form.Item
          label={t("ceo.approvals.rejectReasonLabel")}
          required
          validateStatus={fieldError ? "error" : undefined}
          help={fieldError || undefined}
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            rows={4}
            autoFocus
            value={reason}
            maxLength={500}
            showCount
            disabled={loading}
            // Form.Item has no `name` here, so the label is not wired to the
            // control automatically — name it explicitly.
            aria-label={t("ceo.approvals.rejectReasonLabel")}
            placeholder={t("ceo.approvals.rejectReasonPlaceholder")}
            onChange={(event) => {
              setReason(event.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
        </Form.Item>
      </Form>
      {errorMessage && (
        <Alert
          type="error"
          showIcon
          message={errorMessage}
          style={{ marginTop: 12, borderRadius: 10 }}
        />
      )}
    </Modal>
  );
}
