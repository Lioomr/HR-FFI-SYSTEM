import { Button, message, Typography } from "antd";
import { WarningOutlined, BugOutlined, ReloadOutlined } from "@ant-design/icons";
import { useNavigate, useRouteError } from "react-router-dom";
import { useState } from "react";
import { reportErrorApi } from "../services/api/errorApi";

export default function RouteErrorBoundary() {
  const err = useRouteError() as any;
  const navigate = useNavigate();
  const [reporting, setReporting] = useState(false);

  const title = "Something went wrong";
  const subtitle =
    err?.statusText ||
    err?.message ||
    "An unexpected error occurred while rendering this page.";

  const handleReport = async () => {
    setReporting(true);
    try {
      await reportErrorApi({
        message: subtitle,
        stack: err?.stack || String(err),
        url: window.location.href,
      });
      message.success("Error reported successfully. Thank you.");
    } catch (apiErr) {
      console.error("Failed to report error:", apiErr);
      message.error("Failed to report error.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(145deg, #1a1a1a 0%, #2a2a2a 40%, #1f1f1f 70%, #333333 100%)",
        position: "relative",
        overflow: "hidden",
        padding: 24,
      }}
    >
      {/* Background decorative circles */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {[
          { w: 400, h: 400, top: -100, right: -100, op: 0.06 },
          { w: 300, h: 300, bottom: -80, left: -80, op: 0.05 },
          { w: 200, h: 200, top: "40%", left: "60%", op: 0.04 },
        ].map((c, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: c.w,
              height: c.h,
              top: c.top,
              bottom: c.bottom,
              left: c.left,
              right: c.right,
              borderRadius: "50%",
              background: "rgba(251,146,60," + c.op + ")",
              border: "1px solid rgba(251,146,60,0.1)",
            }}
          />
        ))}
      </div>

      <div
        className="glass"
        style={{
          borderRadius: 20,
          padding: "48px 32px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          maxWidth: 720,
          width: "100%",
          textAlign: "center",
          animation: "fadeInUp 0.5s ease both",
          position: "relative",
          zIndex: 1,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            background: "linear-gradient(135deg, #ef4444, #f87171)",
            borderRadius: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 26,
            boxShadow: "0 8px 24px rgba(239,68,68,0.35)",
            marginBottom: 24,
          }}
        >
          <WarningOutlined />
        </div>

        <h1
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: "white",
            letterSpacing: "-0.03em",
            marginBottom: 12,
            fontFamily: "'Outfit', 'Inter', sans-serif",
            lineHeight: 1.2,
            textShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {title}
        </h1>

        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 18, marginBottom: 32 }}>
          {subtitle}
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
          <Button
            type="primary"
            size="large"
            icon={<ReloadOutlined />}
            onClick={() => window.location.reload()}
            style={{
              height: 48,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              background: "linear-gradient(135deg, #f97316, #ea580c)",
              border: "none",
              boxShadow: "0 6px 20px rgba(249,115,22,0.4)",
              letterSpacing: "0.01em",
              minWidth: 160,
            }}
          >
            Reload Page
          </Button>

          <Button
            type="default"
            size="large"
            onClick={() => navigate("/")}
            style={{
              height: 48,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              minWidth: 160,
            }}
          >
            Back to Home
          </Button>

          <Button
            type="default"
            size="large"
            icon={<BugOutlined />}
            loading={reporting}
            onClick={handleReport}
            style={{
              height: 48,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              minWidth: 200,
            }}
          >
            Report Issue
          </Button>
        </div>

        {err && (
          <div style={{ textAlign: "left", marginTop: 16 }}>
            <Typography.Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
              Technical Details:
            </Typography.Text>
            <pre
              style={{
                marginTop: 8,
                padding: 16,
                borderRadius: 12,
                background: "rgba(0,0,0,0.3)",
                color: "rgba(255,255,255,0.7)",
                overflow: "auto",
                maxHeight: 200,
                fontSize: 12,
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              {String(err?.stack || err)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
