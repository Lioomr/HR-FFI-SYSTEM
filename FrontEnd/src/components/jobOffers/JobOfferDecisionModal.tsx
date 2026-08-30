import { useEffect, useState } from "react";
import { Alert, Form, Input, Modal, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";

const { Paragraph } = Typography;

export type JobOfferDecisionValues = {
  reason: string;
  recommendation: string;
};

/**
 * The one dialog behind all three CEO decisions.
 *
 * A rejection or a change request always carries a written reason, so it is
 * required and validated inline. The recommendation is optional on every
 * decision: it is guidance for HR, not a justification. `destroyOnHidden` keeps
 * a previous decision's text from reappearing.
 */
export default function JobOfferDecisionModal({
  open,
  title,
  subject,
  confirmText,
  requireReason,
  danger = false,
  loading = false,
  errorMessage,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  /** Who the decision is about, shown above the fields. */
  subject?: string;
  confirmText: string;
  /** True for reject and request-changes, which the backend refuses without one. */
  requireReason: boolean;
  danger?: boolean;
  loading?: boolean;
  /** Server-side failure, shown under the fields so the text is not lost. */
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (values: JobOfferDecisionValues) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setRecommendation("");
      setFieldError(null);
    }
  }, [open]);

  const handleOk = async () => {
    const trimmedReason = reason.trim();
    if (requireReason && !trimmedReason) {
      setFieldError(t("jobOffers.approval.reasonRequired"));
      return;
    }
    setFieldError(null);
    await onSubmit({
      reason: trimmedReason,
      recommendation: recommendation.trim(),
    });
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={confirmText}
      okButtonProps={{ danger, loading, "aria-label": confirmText }}
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
      <Form layout="vertical">
        {requireReason && (
          <Form.Item
            label={t("jobOffers.approval.reason")}
            required
            validateStatus={fieldError ? "error" : undefined}
            help={fieldError || undefined}
          >
            <Input.TextArea
              rows={3}
              value={reason}
              disabled={loading}
              onChange={(event) => setReason(event.target.value)}
              aria-label={t("jobOffers.approval.reason")}
            />
          </Form.Item>
        )}
        <Form.Item
          label={t("jobOffers.approval.recommendation")}
          extra={t("jobOffers.approval.recommendationHint")}
        >
          <Input.TextArea
            rows={3}
            value={recommendation}
            disabled={loading}
            onChange={(event) => setRecommendation(event.target.value)}
            aria-label={t("jobOffers.approval.recommendation")}
          />
        </Form.Item>
      </Form>
      {errorMessage && (
        <Alert
          type="error"
          showIcon
          style={{ borderRadius: 12 }}
          message={errorMessage}
        />
      )}
    </Modal>
  );
}
