import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../requests/ApprovalFlowMap";
import { stageActorFromWorkflow } from "../requests/workflowPresentation";
import type { AnnualLeavePaymentRequest } from "../../services/api/annualLeavePaymentsApi";

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

/**
 * Employee -> HR review -> CEO decision, read from the settlement's own
 * decision fields (`hr_reviewed_at`, `ceo_decided_at` and their notes). The
 * workflow snapshot additionally supplies the recorded history to the employee panel.
 */
function buildStages(
  request: AnnualLeavePaymentRequest,
  t: TranslateFn,
): ApprovalFlowStage[] {
  const cancelled = request.status === "cancelled";
  const hrState: ApprovalFlowStage["state"] = request.hr_reviewed_at
    ? "completed"
    : cancelled
      ? "skipped"
      : request.status === "pending_hr"
        ? "current"
        : "upcoming";

  const ceoState: ApprovalFlowStage["state"] = request.ceo_decided_at
    ? request.status === "rejected"
      ? "rejected"
      : "completed"
    : cancelled
      ? "skipped"
      : request.status === "pending_ceo"
        ? "current"
        : "upcoming";

  const resolutionLabel =
    request.resolution === "carry_forward"
      ? t("annualPayment.resolution.carryForward")
      : t("annualPayment.resolution.pay");

  return [
    {
      key: "submitted",
      title: t("leave.approvalMap.submitted"),
      state: "completed",
      note: request.employee_note || t("leave.approvalMap.requestSent"),
      actor:
        stageActorFromWorkflow(request.workflow, "submitted") ??
        (request.employee_name ? { full_name: request.employee_name } : null),
      at: request.submitted_at,
    },
    {
      key: "hr",
      title: t("leave.approvalMap.hrReview"),
      state: hrState,
      detail:
        hrState === "completed"
          ? `${t("annualPayment.resolution")}: ${resolutionLabel}`
          : undefined,
      note:
        request.hr_review_note ||
        (hrState === "completed"
          ? t("leave.approvalMap.forwarded")
          : t(`leave.approvalMap.${hrState}`)),
      actor: stageActorFromWorkflow(request.workflow, "hr"),
      at: request.hr_reviewed_at,
    },
    {
      key: "ceo",
      title: t("leave.approvalMap.ceoReview"),
      state: ceoState,
      note: request.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      actor: stageActorFromWorkflow(request.workflow, "ceo"),
      at: request.ceo_decided_at,
    },
    ...(cancelled
      ? [
          {
            key: "cancelled",
            title: t("status.cancelled"),
            state: "cancelled" as const,
            note: t("requests.cancel.success"),
            actor: stageActorFromWorkflow(request.workflow, "cancelled"),
            at: request.cancelled_at,
          },
        ]
      : []),
  ];
}

export default function AnnualLeaveSettlementApprovalMap({
  request,
  t,
}: {
  request: AnnualLeavePaymentRequest;
  t: TranslateFn;
}) {
  return (
    <ApprovalFlowMap
      eyebrow={t("leave.approvalMap.eyebrow")}
      title={t("leave.approvalMap.title")}
      stages={buildStages(request, t)}
      t={t}
    />
  );
}
