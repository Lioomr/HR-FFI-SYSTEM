import { Card, Skeleton } from "antd";

export default function LoadingState({
  title,
  lines = 6,
}: {
  title?: string;
  lines?: number;
}) {
  return (
    <Card style={{ borderRadius: 16 }}>
      {title ? <h3 style={{ marginTop: 0 }}>{title}</h3> : null}
      <Skeleton active paragraph={{ rows: lines }} />
    </Card>
  );
}
