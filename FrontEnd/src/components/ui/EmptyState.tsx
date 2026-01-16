import { Button, Card, Empty, Space } from "antd";

export default function EmptyState({
  title = "No data",
  description = "Nothing to show here yet.",
  actionText,
  onAction,
}: {
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <Card style={{ borderRadius: 16 }}>
      <Empty
        description={
          <Space direction="vertical" size={4}>
            <strong>{title}</strong>
            <span>{description}</span>
            {actionText && onAction ? (
              <Button type="primary" onClick={onAction}>
                {actionText}
              </Button>
            ) : null}
          </Space>
        }
      />
    </Card>
  );
}
