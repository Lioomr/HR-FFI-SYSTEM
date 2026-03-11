import { ClockCircleOutlined, CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined } from "@ant-design/icons";
import { Card, Space, Tag, Typography } from "antd";

const { Paragraph, Text } = Typography;

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

export type ApprovalFlowStage = {
  key: string;
  title: string;
  state: "completed" | "current" | "rejected" | "upcoming" | "skipped";
  note: string;
  at?: string | null;
};

function getStageColor(state: ApprovalFlowStage["state"]) {
  switch (state) {
    case "completed":
      return { accent: "#16a34a", surface: "#f0fdf4", border: "#bbf7d0" };
    case "current":
      return { accent: "#f97316", surface: "#fff7ed", border: "#fdba74" };
    case "rejected":
      return { accent: "#dc2626", surface: "#fef2f2", border: "#fecaca" };
    case "skipped":
      return { accent: "#64748b", surface: "#f8fafc", border: "#cbd5e1" };
    default:
      return { accent: "#94a3b8", surface: "#f8fafc", border: "#e2e8f0" };
  }
}

function getStageIcon(state: ApprovalFlowStage["state"]) {
  switch (state) {
    case "completed":
      return <CheckCircleFilled />;
    case "current":
      return <ClockCircleOutlined />;
    case "rejected":
      return <CloseCircleFilled />;
    case "skipped":
      return <MinusCircleOutlined />;
    default:
      return <ClockCircleOutlined />;
  }
}

export default function ApprovalFlowMap({
  eyebrow,
  title,
  stages,
  t,
}: {
  eyebrow: string;
  title: string;
  stages: ApprovalFlowStage[];
  t: TranslateFn;
}) {
  return (
    <Card
      style={{
        borderRadius: 20,
        border: "1px solid #e5e7eb",
        background: "linear-gradient(180deg, #ffffff 0%, #fffaf5 100%)",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.06)",
      }}
      bodyStyle={{ padding: 20 }}
    >
      <Space direction="vertical" size={6} style={{ width: "100%", marginBottom: 18 }}>
        <Text style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#f97316" }}>
          {eyebrow}
        </Text>
        <Text style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{title}</Text>
      </Space>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
        }}
      >
        {stages.map((stage, index) => {
          const colors = getStageColor(stage.state);
          return (
            <div
              key={stage.key}
              style={{
                position: "relative",
                padding: 16,
                borderRadius: 18,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                minHeight: 140,
              }}
            >
              {index < stages.length - 1 ? (
                <div
                  style={{
                    position: "absolute",
                    top: 28,
                    right: -10,
                    width: 20,
                    height: 2,
                    background: "linear-gradient(90deg, rgba(249,115,22,0.35), rgba(148,163,184,0.25))",
                  }}
                />
              ) : null}
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      background: "#fff",
                      border: `1px solid ${colors.border}`,
                      display: "grid",
                      placeItems: "center",
                      color: colors.accent,
                    }}
                  >
                    {getStageIcon(stage.state)}
                  </div>
                  <Tag color={stage.state === "skipped" ? "default" : stage.state === "rejected" ? "red" : stage.state === "completed" ? "green" : "orange"}>
                    {t(`leave.approvalMap.${stage.state}`)}
                  </Tag>
                </div>
                <Text style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{stage.title}</Text>
                <Paragraph style={{ marginBottom: 0, color: "#475569", minHeight: 44 }}>{stage.note}</Paragraph>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {stage.at ? new Date(stage.at).toLocaleString() : t("leave.approvalMap.noDate")}
                </Text>
              </Space>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
