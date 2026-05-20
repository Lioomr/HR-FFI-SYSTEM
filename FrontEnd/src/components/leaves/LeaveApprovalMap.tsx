import ApprovalFlowMap, { type ApprovalFlowStage } from "../requests/ApprovalFlowMap";

import type { LeaveRequest } from "../../services/api/leaveApi";
import type { WorkflowActor } from "../../types/workflow";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

function inferDecisionNote(request: LeaveRequest) {
  return request.ceo_decision_note || request.hr_decision_note || request.manager_decision_note || request.delegate_decision_note || request.rejection_reason || "";
}

function getDelegatedEmployeeName(request: LeaveRequest) {
  const delegatedTo = request.delegated_to;
  if (!delegatedTo) return "";
  return delegatedTo.full_name || delegatedTo.email || "";
}

function getActorDisplayName(actor?: WorkflowActor | null) {
  return actor?.full_name || actor?.email || "";
}

function getWorkflowStageActorName(request: LeaveRequest, stageKey: string) {
  const workflow = request.workflow;
  if (!workflow) return "";

  if (workflow.current_stage === stageKey) {
    const currentActorName = getActorDisplayName(workflow.current_actor);
    if (currentActorName) return currentActorName;
  }

  const historyEntry = [...(workflow.history || [])].reverse().find(
    (item) =>
      item.approver_role === stageKey ||
      item.stage === stageKey ||
      item.from_stage === stageKey ||
      item.to_stage === stageKey
  );
  return getActorDisplayName(historyEntry?.actor);
}

function buildStages(request: LeaveRequest, t: TranslateFn): ApprovalFlowStage[] {
  const isManual = request.source === "hr_manual";
  const needsManager =
    request.status === "pending_manager" ||
    Boolean(request.manager_decision_at || request.manager_decision_note);
  const needsDelegate =
    request.status === "pending_delegate" ||
    Boolean(request.delegated_to || request.delegate_decision_at || request.delegate_decision_note);
  const needsCeo =
    request.status === "pending_ceo" ||
    Boolean(request.ceo_decision_at || request.ceo_decision_note || request.leave_type?.requires_ceo_approval);
  const finalRejected = request.status === "rejected";
  const finalCancelled = request.status === "cancelled";
  const decisionNote = inferDecisionNote(request);
  const delegatedEmployeeName = getDelegatedEmployeeName(request);
  const managerName = getWorkflowStageActorName(request, "manager");
  const hrManagerName = getWorkflowStageActorName(request, "hr");
  const ceoName = getWorkflowStageActorName(request, "ceo");

  if (isManual) {
    return [
      {
        key: "manual_entry",
        title: t("leave.approvalMap.manualEntry"),
        state: "completed",
        note: request.manual_entry_reason || t("leave.approvalMap.recordedByHr"),
        at: request.created_at,
      },
      {
        key: "manual_approval",
        title: t("leave.approvalMap.hrApproval"),
        state: request.status === "rejected" ? "rejected" : "completed",
        note: request.status === "rejected" ? decisionNote || t("leave.approvalMap.rejected") : t("leave.approvalMap.autoApproved"),
        at: request.decided_at || request.created_at,
      },
    ];
  }

  const delegateState: ApprovalFlowStage["state"] = !needsDelegate
    ? "skipped"
    : finalRejected && !!request.delegate_decision_note && !request.manager_decision_note && !request.hr_decision_note && !request.ceo_decision_note
      ? "rejected"
      : finalCancelled && Boolean(request.delegate_decision_at)
        ? "completed"
      : request.delegate_decision_at
        ? "completed"
        : request.status === "pending_delegate"
          ? "current"
          : "upcoming";

  const managerState: ApprovalFlowStage["state"] = !needsManager
    ? "skipped"
    : finalRejected && !!request.manager_decision_note && !request.hr_decision_note && !request.ceo_decision_note
      ? "rejected"
      : finalCancelled && Boolean(request.manager_decision_at)
        ? "completed"
      : request.manager_decision_at
        ? "completed"
        : request.status === "pending_manager"
          ? "current"
          : "upcoming";

  const isPendingHrCompletion = request.status === "pending_hr_completion";

  const hrState: ApprovalFlowStage["state"] = finalCancelled
    ? request.decided_at || request.hr_decision_note || request.decision_reason
      ? "completed"
      : needsManager && !request.manager_decision_at
        ? "upcoming"
        : "upcoming"
    : finalRejected && (!!request.hr_decision_note || !request.manager_decision_note)
    ? "rejected"
    : request.status === "pending_hr"
      ? "current"
      : request.status === "pending_ceo" || isPendingHrCompletion || request.status === "approved" || Boolean(request.decided_at || request.hr_decision_note)
        ? "completed"
        : (needsDelegate && !request.delegate_decision_at) || (needsManager && !request.manager_decision_at)
          ? "upcoming"
          : "current";

  const ceoState: ApprovalFlowStage["state"] = !needsCeo
    ? "skipped"
    : finalRejected && !!request.ceo_decision_note
      ? "rejected"
      : finalCancelled && Boolean(request.ceo_decision_at)
        ? "completed"
      : request.status === "pending_ceo"
        ? "current"
        : request.ceo_decision_at || request.status === "approved" || isPendingHrCompletion
          ? "completed"
          : "upcoming";

  const hrCompletionState: ApprovalFlowStage["state"] = !needsCeo
    ? "skipped"
    : isPendingHrCompletion
      ? "current"
      : request.status === "approved"
        ? "completed"
        : finalRejected
          ? "skipped"
          : "upcoming";

  const stages: ApprovalFlowStage[] = [
    {
      key: "submitted",
      title: t("leave.approvalMap.submitted"),
      state: "completed",
      note: t("leave.approvalMap.requestSent"),
      at: request.created_at,
    },
    {
      key: "delegate",
      title: t("leave.approvalMap.delegateReview"),
      state: delegateState,
      detail: delegatedEmployeeName
        ? t(
          "leave.approvalMap.alternativeEmployeeName",
          { name: delegatedEmployeeName },
          `Alternative Employee: ${delegatedEmployeeName}`
        )
        : undefined,
      note:
        delegateState === "skipped"
          ? t("leave.approvalMap.notRequired")
          : request.delegate_decision_note || t(`leave.approvalMap.${delegateState}`),
      at: request.delegate_decision_at,
    },
    {
      key: "manager",
      title: t("leave.approvalMap.managerReview"),
      state: managerState,
      detail: managerName
        ? t("leave.approvalMap.managerName", { name: managerName }, `Manager: ${managerName}`)
        : undefined,
      note:
        managerState === "skipped"
          ? t("leave.approvalMap.notRequired")
          : request.manager_decision_note || t(`leave.approvalMap.${managerState}`),
      at: request.manager_decision_at,
    },
    {
      key: "hr",
      title: t("leave.approvalMap.hrReview"),
      state: hrState,
      detail: hrManagerName
        ? t("leave.approvalMap.hrManagerName", { name: hrManagerName }, `HR Manager: ${hrManagerName}`)
        : undefined,
      note:
        request.hr_decision_note ||
        request.decision_reason ||
        (hrState === "completed" ? t("leave.approvalMap.forwarded") : t(`leave.approvalMap.${hrState}`)),
      at: request.decided_at,
    },
    {
      key: "ceo",
      title: t("leave.approvalMap.ceoReview"),
      state: ceoState,
      detail: ceoName
        ? t("leave.approvalMap.ceoName", { name: ceoName }, `CEO: ${ceoName}`)
        : undefined,
      note:
        ceoState === "skipped"
          ? t("leave.approvalMap.notRequired")
          : request.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      at: request.ceo_decision_at,
    },
    {
      key: "hr_completion",
      title: t("leave.approvalMap.hrCompletion", "HR Completion"),
      state: hrCompletionState,
      note:
        hrCompletionState === "skipped"
          ? t("leave.approvalMap.notRequired")
          : hrCompletionState === "current"
            ? t("leave.approvalMap.hrCompletionPending", "Waiting for HR to upload visa and complete the request.")
            : hrCompletionState === "completed"
              ? t("leave.approvalMap.completed")
              : t("leave.approvalMap.upcoming"),
      at: hrCompletionState === "completed" ? (request.decided_at || request.updated_at) : undefined,
    },
  ];

  if (finalCancelled) {
    stages.push({
      key: "cancelled",
      title: t("status.cancelled") === "status.cancelled" ? "Cancelled" : t("status.cancelled"),
      state: "cancelled",
      note: t("leave.cancelled") === "leave.cancelled" ? "Request cancelled by employee." : t("leave.cancelled"),
      at: request.updated_at,
    });
  }

  return stages;
}

export default function LeaveApprovalMap({ request, t }: { request: LeaveRequest; t: TranslateFn }) {
  return (
    <ApprovalFlowMap
      eyebrow={t("leave.approvalMap.eyebrow")}
      title={t("leave.approvalMap.title")}
      stages={buildStages(request, t)}
      t={t}
    />
  );
}
