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
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Left: accent bar + title + subtitle */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          {/* Gradient accent pill */}
          <div
            style={{
              width: 4,
              height: 44,
              borderRadius: 4,
              background: "linear-gradient(180deg, #f97316, #fb923c)",
              flexShrink: 0,
              marginTop: 2,
            }}
          />
          <div>
            <Space align="center" style={{ marginBottom: subtitle ? 2 : 0 }}>
              <Typography.Title
                level={3}
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#0f172a",
                  letterSpacing: "-0.02em",
                }}
              >
                {title}
              </Typography.Title>
              {tags}
            </Space>
            {subtitle && (
              <Typography.Text
                style={{ color: "#64748b", fontSize: 14, fontWeight: 400 }}
              >
                {subtitle}
              </Typography.Text>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
