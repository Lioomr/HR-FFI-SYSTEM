import { Button } from "antd";
import { InboxOutlined } from "@ant-design/icons";

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
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: "56px 24px",
        textAlign: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        animation: "fadeInUp 0.4s ease both",
      }}
    >
      {/* Illustration */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: "linear-gradient(135deg, #fff4e6, #fff7ed)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
        }}
      >
        <InboxOutlined style={{ fontSize: 32, color: "#f97316" }} />
      </div>

      <div
        style={{
          fontWeight: 700,
          fontSize: 18,
          color: "#0f172a",
          marginBottom: 8,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>

      <div style={{ color: "#64748b", fontSize: 14, marginBottom: actionText ? 24 : 0 }}>
        {description}
      </div>

      {actionText && onAction && (
        <Button
          type="primary"
          size="large"
          onClick={onAction}
          style={{ borderRadius: 10, paddingLeft: 24, paddingRight: 24 }}
        >
          {actionText}
        </Button>
      )}
    </div>
  );
}
