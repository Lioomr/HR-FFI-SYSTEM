import { useState } from "react";
import {
  ClockCircleOutlined,
  DownOutlined,
  UpOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { Button, Card, Grid, Space, Tag, Typography } from "antd";
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
  labelKey?: string;
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
    stage.labelKey
      ? t(stage.labelKey, stage.title)
      : t(`workflow.role.${stage.key}`, stage.title);

  const activeStages = stages.filter((stage) => stage.state !== "skipped");
  const skippedCount = stages.length - activeStages.length;
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

  // On phones the waiting (or final rejected/cancelled) stage keeps its full
  // card and the rest shrink to mini cards, so the flow fits on one screen.
  const isMobile = !Grid.useBreakpoint().md;
  const [showAll, setShowAll] = useState(false);
  const compact = isMobile && !showAll;
  const focusIndex = stages.findIndex(
    (stage) =>
      stage.state === "current" ||
      stage.state === "rejected" ||
      stage.state === "cancelled",
  );

  const renderStageCard = (stage: ApprovalFlowStage, index: number) => {
    const colors = getStageColor(stage.state);
    // An undated stage only says "Awaiting action" while it is the one being
    // waited on; a finished, skipped or closed stage must not claim that.
    const footerText = stage.at
      ? `${t("workflow.updated")} ${formatDateTime(stage.at)}`
      : stage.state === "current"
        ? t("leave.approvalMap.noDate")
        : stage.state === "upcoming"
          ? t("leave.approvalMap.notReached")
          : "";
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
          {footerText ? (
            <Space size={5}>
              <ClockCircleOutlined style={{ color: "#94a3b8", fontSize: 12 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {footerText}
              </Text>
            </Space>
          ) : null}
        </Space>
      </div>
    );
  };

  // Desktop and expanded phone view: one vertical trail. A rail of nodes joins
  // the steps in order; each node and the line leaving it carry the step state,
  // so the path reads top to bottom without relying on grid wrapping.
  const renderTrailStep = (
    stage: ApprovalFlowStage,
    index: number,
    isLast: boolean,
  ) => {
    const colors = getStageColor(stage.state);
    const skipped = stage.state === "skipped";
    const filled = stage.state === "completed" || stage.state === "rejected";
    const current = stage.state === "current";
    const footerText = stage.at
      ? `${t("workflow.updated")} ${formatDateTime(stage.at)}`
      : current
        ? t("leave.approvalMap.noDate")
        : stage.state === "upcoming"
          ? t("leave.approvalMap.notReached")
          : "";
    const nodeSize = skipped ? 22 : 36;

    return (
      <li
        key={stage.key}
        aria-current={current ? "step" : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: "36px minmax(0, 1fr)",
          columnGap: 14,
          listStyle: "none",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: nodeSize,
              height: nodeSize,
              marginTop: skipped ? 7 : 0,
              flexShrink: 0,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              fontSize: skipped ? 12 : 16,
              background: filled ? colors.accent : "#fff",
              color: filled ? "#fff" : colors.accent,
              boxShadow: current
                ? `inset 0 0 0 2px ${colors.accent}, 0 0 0 5px rgba(249, 115, 22, 0.14)`
                : filled
                  ? `0 4px 10px ${colors.accent}33`
                  : `inset 0 0 0 1.5px ${colors.border}`,
            }}
          >
            {getStageIcon(stage.state)}
          </div>
          {isLast ? null : (
            <div
              style={{
                flex: 1,
                width: 2,
                minHeight: 14,
                margin: "4px 0",
                borderRadius: 2,
                background:
                  stage.state === "completed"
                    ? colors.accent
                    : "repeating-linear-gradient(to bottom, #cbd5e1 0 4px, transparent 4px 8px)",
              }}
            />
          )}
        </div>

        <div style={{ paddingBottom: isLast ? 0 : 14, minWidth: 0 }}>
          {skipped ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 36,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  color: "#94a3b8",
                }}
              >
                {getStageLabel(stage)}
              </Text>
              <Text style={{ fontSize: 12, color: "#94a3b8" }}>
                · {getStateLabel(stage.state)}
              </Text>
            </div>
          ) : (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                background: colors.surface,
                boxShadow: `0 0 0 1px ${colors.border}, 0 1px 2px rgba(15, 23, 42, 0.04)`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("workflow.step", { number: index + 1 })}
                  </Text>
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
                </div>
                <Tag
                  style={{ marginInlineEnd: 0 }}
                  color={
                    stage.state === "cancelled"
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
              {stage.detail ? (
                <Text
                  style={{
                    display: "block",
                    marginTop: 4,
                    color: "#0f172a",
                    fontSize: 13,
                    fontWeight: 600,
                    overflowWrap: "anywhere",
                  }}
                >
                  {stage.detail}
                </Text>
              ) : null}
              {stage.note ? (
                <Paragraph
                  style={{
                    margin: "8px 0 0",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.7)",
                    color: "#475569",
                    fontSize: 13,
                    textWrap: "pretty",
                  }}
                >
                  {stage.note}
                </Paragraph>
              ) : null}
              {footerText ? (
                <Space size={5} style={{ marginTop: 8 }}>
                  <ClockCircleOutlined
                    style={{ color: "#94a3b8", fontSize: 12 }}
                  />
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {footerText}
                  </Text>
                </Space>
              ) : null}
            </div>
          )}
        </div>
      </li>
    );
  };

  const renderMiniCard = (stage: ApprovalFlowStage, index: number) => {
    const colors = getStageColor(stage.state);
    return (
      <div
        key={stage.key}
        style={{
          minWidth: 0,
          padding: "10px 12px",
          borderRadius: 14,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: colors.accent,
              fontSize: 16,
            }}
          >
            {getStageIcon(stage.state)}
          </span>
          <Text
            style={{
              minWidth: 0,
              fontSize: 12,
              fontWeight: 800,
              color: "#0f172a",
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              overflowWrap: "anywhere",
            }}
          >
            {getStageLabel(stage)}
          </Text>
        </div>
        <Text
          style={{
            display: "block",
            marginTop: 4,
            fontSize: 11,
            fontWeight: 600,
            color: colors.accent,
          }}
        >
          {t("workflow.step", { number: index + 1 })} ·{" "}
          {getStateLabel(stage.state)}
        </Text>
      </div>
    );
  };

  return (
    <Card
      style={{
        borderRadius: 20,
        border: "1px solid #e5e7eb",
        background: "linear-gradient(180deg, #ffffff 0%, #fffaf5 100%)",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.06)",
      }}
      bodyStyle={{ padding: isMobile ? 14 : 20 }}
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
            fontVariantNumeric: "tabular-nums",
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
            {skippedCount > 0
              ? ` · ${t("workflow.progressSkipped", { count: skippedCount })}`
              : ""}
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

      {compact ? (
        // Steps stay in order; the focus stage spans both columns in its place.
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          {stages.map((stage, index) =>
            index === focusIndex ? (
              <div key={stage.key} style={{ gridColumn: "1 / -1" }}>
                {renderStageCard(stage, index)}
              </div>
            ) : (
              renderMiniCard(stage, index)
            ),
          )}
        </div>
      ) : (
        <ol style={{ margin: 0, padding: 0 }}>
          {stages.map((stage, index) =>
            renderTrailStep(stage, index, index === stages.length - 1),
          )}
        </ol>
      )}
      {isMobile && (
        <Button
          type="link"
          block
          icon={
            showAll ? <UpOutlined aria-hidden /> : <DownOutlined aria-hidden />
          }
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          style={{ marginTop: 8, fontWeight: 600, color: "#ea580c" }}
        >
          {showAll ? t("workflow.hideDetails") : t("workflow.showDetails")}
        </Button>
      )}
    </Card>
  );
}
