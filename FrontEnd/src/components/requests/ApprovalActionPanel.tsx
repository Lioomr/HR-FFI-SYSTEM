import { Button, Card, Input, Space } from "antd";

import { useI18n } from "../../i18n/useI18n";

type Props = {
  canApprove?: boolean;
  canReject?: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
  approveLoading?: boolean;
  rejectLoading?: boolean;
};

export default function ApprovalActionPanel({
  canApprove,
  canReject,
  note,
  onNoteChange,
  onApprove,
  onReject,
  approveLoading,
  rejectLoading,
}: Props) {
  const { t } = useI18n();
  if (!canApprove && !canReject) return null;

  return (
    <Card style={{ borderRadius: 16 }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Input.TextArea
          rows={4}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={t("workflow.approvalNotePlaceholder")}
        />
        <Space>
          {canApprove ? (
            <Button type="primary" onClick={onApprove} loading={approveLoading}>
              {t("common.approve")}
            </Button>
          ) : null}
          {canReject ? (
            <Button danger onClick={onReject} loading={rejectLoading}>
              {t("common.reject")}
            </Button>
          ) : null}
        </Space>
      </Space>
    </Card>
  );
}
