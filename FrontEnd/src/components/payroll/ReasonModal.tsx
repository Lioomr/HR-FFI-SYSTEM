import { useEffect, type ReactNode } from "react";
import { Alert, Form, Input, Modal } from "antd";
import { useI18n } from "../../i18n/useI18n";

export const REASON_MAX_LENGTH = 2000;

/**
 * Asks for the mandatory audit reason of a payroll mutation (contract 4.2:
 * trimmed, nonempty, max 2000). The parent performs the API call in onSubmit
 * and passes any server reason error or record-level error back in.
 */
export default function ReasonModal({
  open,
  title,
  description,
  okText,
  okDanger,
  submitting,
  reasonError,
  formError,
  extra,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  okText?: string;
  okDanger?: boolean;
  submitting?: boolean;
  /** Server-side error for the `reason` field. */
  reasonError?: string;
  /** Record-level error to show above the field. */
  formError?: string;
  /** Extra form controls rendered before the reason field. */
  extra?: ReactNode;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm<{ reason: string }>();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  useEffect(() => {
    // Only while the dialog (and its Form) is mounted.
    if (!open) return;
    form.setFields([
      { name: "reason", errors: reasonError ? [reasonError] : [] },
    ]);
  }, [open, reasonError, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onSubmit(values.reason.trim());
    } catch {
      // Validation messages are already shown on the field.
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={okText ?? t("common.save")}
      cancelText={t("common.cancel")}
      okButtonProps={{ danger: okDanger, loading: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnHidden
      maskClosable={!submitting}
    >
      {description && <div style={{ marginBottom: 12 }}>{description}</div>}
      {formError && (
        <Alert
          type="error"
          showIcon
          message={formError}
          style={{ marginBottom: 12 }}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        requiredMark
        disabled={submitting}
        onFinish={() => void handleOk()}
      >
        {extra}
        <Form.Item
          name="reason"
          label={t("payroll.ui.reasonLabel")}
          extra={t("payroll.ui.reasonHelp")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t("payroll.ui.reasonRequired"),
            },
            { max: REASON_MAX_LENGTH, message: t("payroll.ui.reasonTooLong") },
          ]}
        >
          <Input.TextArea
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                if (!submitting) void handleOk();
              }
            }}
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            showCount
            aria-label={t("payroll.ui.reasonLabel")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
