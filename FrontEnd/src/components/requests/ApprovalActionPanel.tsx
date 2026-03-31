import { Button, Card, Input, Space } from "antd";

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
  if (!canApprove && !canReject) return null;

  return (
    <Card style={{ borderRadius: 16 }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Input.TextArea rows={4} value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder="Add approval note" />
        <Space>
          {canApprove ? (
            <Button type="primary" onClick={onApprove} loading={approveLoading}>
              Approve
            </Button>
          ) : null}
          {canReject ? (
            <Button danger onClick={onReject} loading={rejectLoading}>
              Reject
            </Button>
          ) : null}
        </Space>
      </Space>
    </Card>
  );
}
