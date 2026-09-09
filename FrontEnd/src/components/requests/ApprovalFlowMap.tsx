import {
  ClockCircleOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { Card, Space, Tag, Typography } from "antd";
import { formatDateTime } from "../../utils/dateTime";

const { Paragraph, Text } = Typography;

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

export type ApprovalFlowStage = {
  key: string;
  title: string;
  state:
    | "completed"
    | "current"
    | "rejected"
    | "upcoming"
    | "skipped"
    | "cancelled";
  note: string;
  detail?: string;
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
    case "cancelled":
      return { accent: "#6b7280", surface: "#f8fafc", border: "#d1d5db" };
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
    case "cancelled":
      return <MinusCircleOutlined />;
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
  const getStateLabel = (state: ApprovalFlowStage["state"]) => {
    if (state === "cancelled") {
      const translated = t("status.cancelled");
      return translated === "status.cancelled" ? "Cancelled" : translated;
    }
    return t(`leave.approvalMap.${state}`);
  };

  const getStageLabel = (stage: ApprovalFlowStage) =>
    t(`workflow.role.${stage.key}`, stage.title);

  const activeStages = stages.filter((stage) => stage.state !== "skipped");
  const completedStages = activeStages.filter(
    (stage) => stage.state === "completed",
  ).length;
  const currentStage = stages.find((stage) => stage.state === "current");
  const terminalStage = stages.find(
    (stage) => stage.state === "rejected" || stage.state === "cancelled",
  );
  const progressPercent = activeStages.length
    ? Math.round((completedStages / activeStages.length) * 100)
    : 0;
  const progressLabel = terminalStage
    ? getStateLabel(terminalStage.state)
    : currentStage
      ? getStageLabel(currentStage)
      : completedStages === activeStages.length
        ? t("workflow.flowComplete")
        : t("workflow.awaitingNextStep");

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
      <Space
        direction="vertical"
        size={6}
        style={{ width: "100%", marginBottom: 18 }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#f97316",
          }}
        >
          {eyebrow}
        </Text>
        <Text style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
          {title}
        </Text>
      </Space>

      <div
        aria-label={t("workflow.progressSummary", {
          completed: completedStages,
          total: activeStages.length,
        })}
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          marginBottom: 18,
          border: "1px solid #e7edf4",
          borderRadius: 14,
          background: "rgba(248, 250, 252, 0.8)",
        }}
      >
        <div
          style={{
            minWidth: 42,
            height: 42,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: terminalStage ? "#fef2f2" : "#fff7ed",
            color: terminalStage ? "#dc2626" : "#ea580c",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {completedStages}/{activeStages.length}
        </div>
        <div style={{ minWidth: 0 }}>
          <Text style={{ display: "block", fontWeight: 700, color: "#1e293b" }}>
            {progressLabel}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("workflow.progressSummary", {
              completed: completedStages,
              total: activeStages.length,
            })}
          </Text>
          <div
            aria-hidden="true"
            style={{
              height: 5,
              marginTop: 7,
              overflow: "hidden",
              borderRadius: 999,
              background: "#e2e8f0",
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                borderRadius: 999,
                background: terminalStage ? "#dc2626" : "#f97316",
                transition: "width 180ms ease",
              }}
            />
          </div>
        </div>
        <Tag
          color={
            terminalStage
              ? terminalStage.state === "rejected"
                ? "red"
                : "default"
              : currentStage
                ? "orange"
                : "green"
          }
          style={{ marginInlineEnd: 0, whiteSpace: "nowrap" }}
        >
          {terminalStage
            ? getStateLabel(terminalStage.state)
            : currentStage
              ? getStateLabel("current")
              : getStateLabel("completed")}
        </Tag>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
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
                boxShadow:
                  stage.state === "current"
                    ? "0 8px 18px rgba(249, 115, 22, 0.10)"
                    : "none",
              }}
              aria-current={stage.state === "current" ? "step" : undefined}
            >
              {index < stages.length - 1 ? (
                <div
                  style={{
                    position: "absolute",
                    top: 28,
                    right: -10,
                    width: 20,
                    height: 2,
                    background:
                      "linear-gradient(90deg, rgba(249,115,22,0.35), rgba(148,163,184,0.25))",
                  }}
                />
              ) : null}
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
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
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("workflow.step", { number: index + 1 })}
                    </Text>
                  </div>
                  <Tag
                    color={
                      stage.state === "skipped" || stage.state === "cancelled"
                        ? "default"
                        : stage.state === "rejected"
                          ? "red"
                          : stage.state === "completed"
                            ? "green"
                            : "orange"
                    }
                  >
                    {getStateLabel(stage.state)}
                  </Tag>
                </div>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "#0f172a",
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                  }}
                >
                  {getStageLabel(stage)}
                </Text>
                {stage.detail ? (
                  <Text
                    style={{
                      color: "#0f172a",
                      fontSize: 13,
                      fontWeight: 600,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {stage.detail}
                  </Text>
                ) : null}
                <Paragraph
                  style={{
                    marginBottom: 0,
                    color: "#475569",
                    minHeight: 44,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(255, 255, 255, 0.56)",
                    fontSize: 13,
                  }}
                >
                  {stage.note}
                </Paragraph>
                <Space size={5}>
                  <ClockCircleOutlined
                    style={{ color: "#94a3b8", fontSize: 12 }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {stage.at
                      ? `${t("workflow.updated")} ${formatDateTime(stage.at)}`
                      : t("leave.approvalMap.noDate")}
                  </Text>
                </Space>
              </Space>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
