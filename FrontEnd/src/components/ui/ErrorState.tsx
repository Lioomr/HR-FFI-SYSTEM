import { Button } from "antd";
import { ExclamationCircleOutlined, ReloadOutlined } from "@ant-design/icons";

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
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: "48px 24px",
        textAlign: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        animation: "fadeInUp 0.4s ease both",
      }}
    >
      {/* Error Icon */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: "linear-gradient(135deg, #fee2e2, #fef2f2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
        }}
      >
        <ExclamationCircleOutlined style={{ fontSize: 32, color: "#ef4444" }} />
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

      <div style={{ color: "#64748b", fontSize: 14, marginBottom: onRetry ? 24 : 0 }}>
        {description}
      </div>

      {onRetry && (
        <Button
          icon={<ReloadOutlined />}
          onClick={onRetry}
          size="large"
          style={{ borderRadius: 10, paddingLeft: 24, paddingRight: 24 }}
        >
          Try Again
        </Button>
      )}
    </div>
  );
}
