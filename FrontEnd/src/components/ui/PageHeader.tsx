import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  secondarySubtitle,
  breadcrumb,
  tags,
  actions,
}: {
  title: string;
  subtitle?: string;
  secondarySubtitle?: string;
  breadcrumb?: string;
  tags?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      {breadcrumb && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#94a3b8",
            marginBottom: 4,
            marginLeft: 18, // Align with title
          }}
        >
          {breadcrumb}
        </div>
      )}
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
              height: 48,
              borderRadius: 4,
              background: "linear-gradient(180deg, #f97316, #fb923c)",
              flexShrink: 0,
              marginTop: 2,
            }}
          />
          <div>
            <Space align="center" style={{ marginBottom: (subtitle || secondarySubtitle) ? 0 : 0 }}>
              <Typography.Title
                level={3}
                style={{
                  margin: 0,
                  fontSize: 24,
                  fontWeight: 800,
                  color: "#0f172a",
                  letterSpacing: "-0.02em",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                {title}
              </Typography.Title>
              {tags}
            </Space>
            {(subtitle || secondarySubtitle) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: -2 }}>
                {subtitle && (
                  <Typography.Text
                    style={{ color: "#64748b", fontSize: 16, fontWeight: 500 }}
                  >
                    {subtitle}
                  </Typography.Text>
                )}
                {subtitle && secondarySubtitle && (
                  <span style={{ color: "#cbd5e1" }}>•</span>
                )}
                {secondarySubtitle && (
                  <Typography.Text
                    style={{ color: "#94a3b8", fontSize: 14, fontWeight: 400 }}
                  >
                    {secondarySubtitle}
                  </Typography.Text>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
