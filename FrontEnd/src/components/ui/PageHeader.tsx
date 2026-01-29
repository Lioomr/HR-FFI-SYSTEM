import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  tags,
  actions,

}: {
  title: string;
  subtitle?: string;
  tags?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
        <div>
          <Space align="center">
            <Typography.Title level={3} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            {tags}
          </Space>
          {subtitle ? (
            <Typography.Text type="secondary">{subtitle}</Typography.Text>
          ) : null}
        </div>

        {actions ? <div>{actions}</div> : null}
      </Space>
    </div>
  );
}
