import ApprovalFlowMap, { type ApprovalFlowStage } from "../requests/ApprovalFlowMap";

import type { AssetReturnRequest } from "../../services/api/assetsApi";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

function isRejectedAtStage(request: AssetReturnRequest, stage: "manager" | "hr" | "ceo") {
  if (request.status !== "REJECTED") return false;
  if (stage === "manager") return Boolean(request.manager_decision_at && !request.hr_decision_at && !request.ceo_decision_at);
  if (stage === "hr") return Boolean(request.hr_decision_at && !request.ceo_decision_at);
  return Boolean(request.ceo_decision_at);
}

function buildStages(request: AssetReturnRequest, t: TranslateFn): ApprovalFlowStage[] {
  const needsManager =
    request.status === "PENDING_MANAGER" || Boolean(request.manager_decision_at || request.manager_decision_note);
  const needsCeo = request.status === "PENDING_CEO" || Boolean(request.ceo_decision_at || request.ceo_decision_note);

  const managerState: ApprovalFlowStage["state"] = !needsManager
    ? "skipped"
    : isRejectedAtStage(request, "manager")
      ? "rejected"
      : request.manager_decision_at
        ? "completed"
        : request.status === "PENDING_MANAGER"
          ? "current"
          : "upcoming";

  const hrState: ApprovalFlowStage["state"] = isRejectedAtStage(request, "hr")
    ? "rejected"
    : request.hr_decision_at
      ? "completed"
      : request.status === "PENDING"
        ? "current"
        : request.status === "PENDING_CEO" || request.status === "APPROVED" || request.status === "PROCESSED"
          ? "completed"
          : needsManager && !request.manager_decision_at
            ? "upcoming"
            : "upcoming";

  const ceoState: ApprovalFlowStage["state"] = !needsCeo
    ? "skipped"
    : isRejectedAtStage(request, "ceo")
      ? "rejected"
      : request.ceo_decision_at
        ? "completed"
        : request.status === "PENDING_CEO"
          ? "current"
          : "upcoming";

  const processedState: ApprovalFlowStage["state"] =
    request.status === "PROCESSED"
      ? "completed"
      : request.status === "APPROVED"
        ? "current"
        : "upcoming";

  return [
    {
      key: "submitted",
      title: t("assets.approvalMap.submitted", "Submitted"),
      state: "completed",
      note: t("assets.approvalMap.requestSent", "Return request submitted."),
      at: request.requested_at,
    },
    {
      key: "manager",
      title: t("assets.approvalMap.managerReview", "Manager Review"),
      state: managerState,
      note:
        managerState === "skipped"
          ? t("assets.approvalMap.notRequired", "Not required")
          : request.manager_decision_note || t(`leave.approvalMap.${managerState}`),
      at: request.manager_decision_at,
    },
    {
      key: "hr",
      title: t("assets.approvalMap.hrReview", "HR Review"),
      state: hrState,
      note:
        request.hr_decision_note ||
        (hrState === "completed"
          ? t("assets.approvalMap.approvedForReturn", "Ready for HR processing.")
          : t(`leave.approvalMap.${hrState}`)),
      at: request.hr_decision_at,
    },
    {
      key: "ceo",
      title: t("assets.approvalMap.ceoReview", "CEO Review"),
      state: ceoState,
      note:
        ceoState === "skipped"
          ? t("assets.approvalMap.notRequired", "Not required")
          : request.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      at: request.ceo_decision_at,
    },
    {
      key: "processed",
      title: t("assets.approvalMap.processed", "Return Processed"),
      state: processedState,
      note:
        request.status === "PROCESSED"
          ? t("assets.approvalMap.returnCompleted", "Asset return has been processed.")
          : request.status === "APPROVED"
            ? t("assets.approvalMap.awaitingHandOff", "Waiting for HR to receive the asset.")
            : t("workflow.noUpdate", "No update yet"),
      at: request.processed_at,
    },
  ];
}

export default function AssetReturnApprovalMap({ request, t }: { request: AssetReturnRequest; t: TranslateFn }) {
  return (
    <ApprovalFlowMap
      eyebrow={t("assets.approvalMap.eyebrow", "Asset Return Workflow")}
      title={t("assets.approvalMap.title", "Approval Progress")}
      stages={buildStages(request, t)}
      t={t}
    />
  );
}
