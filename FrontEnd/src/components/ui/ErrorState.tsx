import { Alert, Button, Card, Space } from "antd";

export default function ErrorState({
  title = "Something went wrong",
  description = "Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <Card style={{ borderRadius: 16 }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert type="error" showIcon message={title} description={description} />
        {onRetry ? (
          <Button type="primary" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
