import ApprovalFlowMap, { type ApprovalFlowStage } from "./ApprovalFlowMap";
import {
  isNonStageAction,
  stageActorFromWorkflow,
} from "./workflowPresentation";
import { useI18n } from "../../i18n/useI18n";
import type { WorkflowSnapshot } from "../../types/workflow";

type TranslateFn = ReturnType<typeof useI18n>["t"];

/**
 * Submitted -> each review stage -> (cancelled), read only from the recorded
 * workflow snapshot. For requests with no decision fields of their own.
 */
function buildStagesFromHistory(
  workflow: WorkflowSnapshot,
  reviewStages: string[],
  t: TranslateFn,
): ApprovalFlowStage[] {
  const history = [...(workflow.history || [])]
    .reverse()
    .filter((item) => !isNonStageAction(item.action));
  const submitEntry = history.find((item) => item.action === "submit");
  const cancelEntry = history.find((item) => item.action === "cancel");
  const closed =
    workflow.status === "cancelled" || workflow.status === "rejected";

  const stages: ApprovalFlowStage[] = [
    {
      key: "submitted",
      title: t("leave.approvalMap.submitted"),
      state: "completed",
      note: submitEntry?.note || t("leave.approvalMap.requestSent"),
      actor: stageActorFromWorkflow(workflow, "submitted"),
      at: submitEntry?.at,
    },
    ...reviewStages.map((stageKey): ApprovalFlowStage => {
      const decision = history.find(
        (item) =>
          item.action !== "submit" &&
          item.action !== "cancel" &&
          (item.approver_role === stageKey || item.from_stage === stageKey),
      );
      const state: ApprovalFlowStage["state"] = decision
        ? decision.action === "reject"
          ? "rejected"
          : "completed"
        : closed
          ? "skipped"
          : workflow.current_stage === stageKey
            ? "current"
            : "upcoming";
      return {
        key: stageKey,
        title: t(`workflow.role.${stageKey}`, stageKey),
        state,
        note: decision?.note || t(`leave.approvalMap.${state}`),
        actor: stageActorFromWorkflow(workflow, stageKey),
        at: decision?.at,
      };
    }),
  ];

  if (workflow.status === "cancelled") {
    stages.push({
      key: "cancelled",
      title: t("status.cancelled"),
      state: "cancelled",
      note: cancelEntry?.note || "",
      actor: cancelEntry?.actor ?? null,
      at: cancelEntry?.at,
    });
  }
  return stages;
}

export default function WorkflowApprovalMap({
  workflow,
  reviewStages,
  title,
}: {
  workflow?: WorkflowSnapshot | null;
  reviewStages: string[];
  title?: string;
}) {
  const { t } = useI18n();
  if (!workflow) return null;
  return (
    <ApprovalFlowMap
      eyebrow={t("leave.approvalMap.eyebrow")}
      title={title ?? t("leave.approvalMap.title")}
      stages={buildStagesFromHistory(workflow, reviewStages, t)}
      t={t}
    />
  );
}
