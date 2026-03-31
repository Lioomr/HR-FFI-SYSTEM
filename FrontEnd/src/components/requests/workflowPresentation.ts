import type { ApprovalFlowStage } from "./ApprovalFlowMap";
import type { WorkflowSnapshot } from "../../types/workflow";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

function toTitle(stage: string, t: TranslateFn) {
  const normalized = (stage || "").toLowerCase();
  const key = `workflow.stage.${normalized}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toState(stepKey: string, workflow?: WorkflowSnapshot): ApprovalFlowStage["state"] {
  if (!workflow) return "upcoming";
  if (stepKey === "cancelled") {
    return workflow.status === "cancelled" ? "cancelled" : "upcoming";
  }
  if (workflow.status === "rejected") {
    return workflow.current_stage === stepKey || workflow.history.some((item) => item.action === "reject" && (item.from_stage === stepKey || item.stage === stepKey))
      ? "rejected"
      : workflow.history.some((item) => item.stage === stepKey || item.from_stage === stepKey)
        ? "completed"
        : "upcoming";
  }
  if (workflow.status === "cancelled") {
    return workflow.history.some((item) => item.stage === stepKey || item.from_stage === stepKey || item.to_stage === stepKey)
      ? "completed"
      : "upcoming";
  }
  if (workflow.status === "approved" || workflow.history.some((item) => item.stage === stepKey || item.from_stage === stepKey)) {
    if (workflow.current_stage === stepKey && workflow.status === "in_review") return "current";
    if (workflow.current_stage !== stepKey && workflow.history.some((item) => item.stage === stepKey || item.from_stage === stepKey)) {
      return "completed";
    }
  }
  if (workflow.current_stage === stepKey) return "current";
  return workflow.history.some((item) => item.stage === stepKey || item.from_stage === stepKey) ? "completed" : "upcoming";
}

export function buildStagesFromWorkflow(
  workflow: WorkflowSnapshot | undefined,
  order: string[],
  t: TranslateFn,
): ApprovalFlowStage[] | null {
  if (!workflow) return null;
  const stageOrder = workflow.status === "cancelled" ? [...order, "cancelled"] : order;
  const cancellationEntry = [...workflow.history].reverse().find((item) => item.action === "cancel" || item.to_status === "cancelled");
  return stageOrder.map((stepKey) => {
    const latest = [...workflow.history]
      .reverse()
      .find((item) => item.stage === stepKey || item.from_stage === stepKey || item.to_stage === stepKey);
    if (stepKey === "cancelled") {
      return {
        key: stepKey,
        title: toTitle(stepKey, t),
        state: "cancelled",
        note: cancellationEntry?.note || "Request cancelled by employee.",
        at: cancellationEntry?.at,
      };
    }
    return {
      key: stepKey,
      title: toTitle(stepKey, t),
      state: toState(stepKey, workflow),
      note: latest?.note || (workflow.current_stage === stepKey ? t("workflow.currentAction", stepKey) : t("workflow.noUpdate", "No update yet")),
      at: latest?.at,
    };
  });
}
