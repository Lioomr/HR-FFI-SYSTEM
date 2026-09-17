import { Button, message, Typography } from "antd";
import {
  WarningOutlined,
  BugOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useNavigate, useRouteError } from "react-router-dom";
import { useEffect, useState } from "react";
import { reportErrorApi } from "../services/api/errorApi";
import { useI18n } from "../i18n/useI18n";

export default function RouteErrorBoundary() {
  const err = useRouteError() as any;
  const navigate = useNavigate();
  const { t } = useI18n();
  const [reporting, setReporting] = useState(false);

  // A deployment replaces Vite's content-hashed lazy chunks. If a tab that
  // predates that deployment later navigates to a lazy route, its old shell
  // can request a chunk that no longer exists. Reload once to fetch the new
  // shell; the session marker prevents a genuine import defect looping forever.
  useEffect(() => {
    const text = String(err?.message || err?.stack || err || "");
    const isStaleChunk =
      /failed to fetch dynamically imported module|importing a module script failed/i.test(
        text,
      );
    const marker = "ffi-recovered-stale-lazy-chunk";
    if (isStaleChunk && sessionStorage.getItem(marker) !== text) {
      sessionStorage.setItem(marker, text);
      window.location.reload();
    }
  }, [err]);

  const title = t("error.generic");
  const subtitle = err?.statusText || err?.message || t("error.renderFailed");

  const handleReport = async () => {
    setReporting(true);
    try {
      await reportErrorApi({
        message: subtitle,
        stack: err?.stack || String(err),
        url: window.location.href,
      });
      message.success(t("error.reportSuccess"));
    } catch (apiErr) {
      console.error("Failed to report error:", apiErr);
      message.error(t("error.reportFailed"));
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
        background:
          "linear-gradient(145deg, #1a1a1a 0%, #2a2a2a 40%, #1f1f1f 70%, #333333 100%)",
        position: "relative",
        overflow: "hidden",
        padding: 24,
      }}
    >
      {/* Background decorative circles */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
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

        <div
          style={{
            color: "rgba(255,255,255,0.8)",
            fontSize: 18,
            marginBottom: 32,
          }}
        >
          {subtitle}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 32,
          }}
        >
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
            {t("error.reloadPage")}
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
            {t("error.notFound.backHome")}
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
            {t("error.reportIssue")}
          </Button>
        </div>

        {err && (
          <div style={{ textAlign: "start", marginTop: 16 }}>
            <Typography.Text
              style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}
            >
              {t("error.technicalDetails")}:
            </Typography.Text>
            <pre
              dir="ltr"
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
