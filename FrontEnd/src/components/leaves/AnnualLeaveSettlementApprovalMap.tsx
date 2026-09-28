import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../requests/ApprovalFlowMap";
import type { AnnualLeavePaymentRequest } from "../../services/api/annualLeavePaymentsApi";

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

/**
 * Employee -> HR review -> CEO decision, read from the settlement's own
 * decision fields (`hr_reviewed_at`, `ceo_decided_at` and their notes). The
 * serializer carries no workflow snapshot, so these fields are the trail.
 */
function buildStages(
  request: AnnualLeavePaymentRequest,
  t: TranslateFn,
): ApprovalFlowStage[] {
  const hrState: ApprovalFlowStage["state"] = request.hr_reviewed_at
    ? "completed"
    : request.status === "pending_hr"
      ? "current"
      : "upcoming";

  const ceoState: ApprovalFlowStage["state"] = request.ceo_decided_at
    ? request.status === "rejected"
      ? "rejected"
      : "completed"
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
      at: request.hr_reviewed_at,
    },
    {
      key: "ceo",
      title: t("leave.approvalMap.ceoReview"),
      state: ceoState,
      note: request.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      at: request.ceo_decided_at,
    },
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
