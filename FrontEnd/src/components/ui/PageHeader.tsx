import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle ? (
            <Typography.Text type="secondary">{subtitle}</Typography.Text>
          ) : null}
        </div>

        {actions ? <div>{actions}</div> : null}
      </Space>
    </div>
  );
}
