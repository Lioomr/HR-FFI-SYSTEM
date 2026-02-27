import { useI18n } from "../i18n/useI18n";
import { Button, message } from "antd";
import { WarningOutlined, BugOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { reportErrorApi } from "../services/api/errorApi";

export default function ServerError500Page() {
    const { t, direction } = useI18n();
    const navigate = useNavigate();
    const [reporting, setReporting] = useState(false);

    const handleReport = async () => {
        setReporting(true);
        try {
            await reportErrorApi({
                message: "500 Server Error encountered by user.",
                stack: "No stack available on generic 500 page.",
                url: window.location.href,
            });
            message.success(t("error.reportSuccess"));
        } catch (err) {
            console.error(err);
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
                direction,
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
                    maxWidth: 440,
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
                        background: "linear-gradient(135deg, #f97316, #fb923c)",
                        borderRadius: 16,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: 26,
                        boxShadow: "0 8px 24px rgba(249,115,22,0.35)",
                        marginBottom: 24,
                    }}
                >
                    <WarningOutlined />
                </div>

                <h1
                    style={{
                        fontSize: 72,
                        fontWeight: 800,
                        color: "white",
                        letterSpacing: "-0.03em",
                        marginBottom: 0,
                        fontFamily: "'Outfit', 'Inter', sans-serif",
                        lineHeight: 1,
                        textShadow: "0 4px 12px rgba(0,0,0,0.3)",
                    }}
                >
                    500
                </h1>

                <div
                    style={{
                        fontSize: 24,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.9)",
                        marginBottom: 12,
                        marginTop: 12,
                    }}
                >
                    {t("error.serverError.title")}
                </div>

                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, marginBottom: 32 }}>
                    {t("error.serverError.desc")}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <Button
                        type="primary"
                        size="large"
                        onClick={() => navigate("/")}
                        style={{
                            height: 48,
                            borderRadius: 12,
                            fontSize: 15,
                            fontWeight: 700,
                            background: "linear-gradient(135deg, #f97316, #ea580c)",
                            border: "none",
                            boxShadow: "0 6px 20px rgba(249,115,22,0.4)",
                            letterSpacing: "0.01em",
                            width: "100%",
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
                            width: "100%",
                        }}
                    >
                        {t("error.reportIssue")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
