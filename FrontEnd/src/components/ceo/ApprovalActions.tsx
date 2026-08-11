import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";

import { useI18n } from "../../i18n/useI18n";

/**
 * The single approve/reject control pair used by every CEO approval screen.
 *
 * Approve is the solid primary button and always comes first; reject is an
 * outlined danger button. Both keep their text label at every breakpoint so no
 * decision is made from an unlabelled icon.
 */
export default function ApprovalActions({
  onApprove,
  onReject,
  approveLoading = false,
  disabled = false,
  approveDisabled = false,
  rejectDisabled = false,
  approveLabel,
  rejectLabel,
  subjectLabel,
  size = "small",
  block = false,
}: {
  onApprove: () => void;
  onReject: () => void;
  approveLoading?: boolean;
  /** Disables both controls, e.g. while another decision is in flight. */
  disabled?: boolean;
  /** Disables approval alone, when the workflow permits only a rejection. */
  approveDisabled?: boolean;
  /** Disables rejection alone, when the workflow permits only an approval. */
  rejectDisabled?: boolean;
  approveLabel?: string;
  rejectLabel?: string;
  /** Appended to the accessible name, e.g. the employee the row is about. */
  subjectLabel?: string;
  size?: "small" | "middle" | "large";
  /** Stack full-width buttons — used inside narrow/stacked layouts. */
  block?: boolean;
}) {
  const { t } = useI18n();
  const approveText = approveLabel ?? t("common.approve");
  const rejectText = rejectLabel ?? t("common.reject");
  const suffix = subjectLabel ? `: ${subjectLabel}` : "";

  return (
    <Space
      size={8}
      wrap
      direction={block ? "vertical" : "horizontal"}
      style={block ? { width: "100%" } : undefined}
    >
      <Button
        type="primary"
        size={size}
        block={block}
        icon={<CheckOutlined aria-hidden />}
        loading={approveLoading}
        disabled={disabled || approveDisabled}
        onClick={onApprove}
        aria-label={`${approveText}${suffix}`}
        style={{ borderRadius: 8, fontWeight: 600 }}
      >
        {approveText}
      </Button>
      <Button
        danger
        size={size}
        block={block}
        icon={<CloseOutlined aria-hidden />}
        disabled={disabled || rejectDisabled || approveLoading}
        onClick={onReject}
        aria-label={`${rejectText}${suffix}`}
        style={{ borderRadius: 8, fontWeight: 600 }}
      >
        {rejectText}
      </Button>
    </Space>
  );
}
