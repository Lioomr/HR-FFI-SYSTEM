import ApprovalFlowMap, { type ApprovalFlowStage } from "../requests/ApprovalFlowMap";

import type { LeaveRequest } from "../../services/api/leaveApi";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

function inferDecisionNote(request: LeaveRequest) {
  return request.ceo_decision_note || request.hr_decision_note || request.manager_decision_note || request.rejection_reason || "";
}

function buildStages(request: LeaveRequest, t: TranslateFn): ApprovalFlowStage[] {
  const isManual = request.source === "hr_manual";
  const needsManager =
    request.status === "pending_manager" ||
    Boolean(request.manager_decision_at || request.manager_decision_note);
  const needsCeo =
    request.status === "pending_ceo" ||
    Boolean(request.ceo_decision_at || request.ceo_decision_note || request.leave_type?.requires_ceo_approval);
  const finalRejected = request.status === "rejected";
  const decisionNote = inferDecisionNote(request);

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

  const managerState: ApprovalFlowStage["state"] = !needsManager
    ? "skipped"
    : finalRejected && !!request.manager_decision_note && !request.hr_decision_note && !request.ceo_decision_note
      ? "rejected"
      : request.manager_decision_at
        ? "completed"
        : request.status === "pending_manager"
          ? "current"
          : "upcoming";

  const hrState: ApprovalFlowStage["state"] = finalRejected && (!!request.hr_decision_note || !request.manager_decision_note)
    ? "rejected"
    : request.status === "pending_hr"
      ? "current"
      : request.status === "pending_ceo" || request.status === "approved" || Boolean(request.decided_at || request.hr_decision_note)
        ? "completed"
        : needsManager && !request.manager_decision_at
          ? "upcoming"
          : "current";

  const ceoState: ApprovalFlowStage["state"] = !needsCeo
    ? "skipped"
    : finalRejected && !!request.ceo_decision_note
      ? "rejected"
      : request.status === "pending_ceo"
        ? "current"
        : request.ceo_decision_at || request.status === "approved"
          ? "completed"
          : "upcoming";

  return [
    {
      key: "submitted",
      title: t("leave.approvalMap.submitted"),
      state: "completed",
      note: t("leave.approvalMap.requestSent"),
      at: request.created_at,
    },
    {
      key: "manager",
      title: t("leave.approvalMap.managerReview"),
      state: managerState,
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
      note:
        ceoState === "skipped"
          ? t("leave.approvalMap.notRequired")
          : request.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      at: request.ceo_decision_at,
    },
  ];
}

export default function LeaveApprovalMap({ request, t }: { request: LeaveRequest; t: TranslateFn }) {
  return <ApprovalFlowMap eyebrow={t("leave.approvalMap.eyebrow")} title={t("leave.approvalMap.title")} stages={buildStages(request, t)} t={t} />;
}
