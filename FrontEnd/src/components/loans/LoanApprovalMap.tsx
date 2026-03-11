import ApprovalFlowMap, { type ApprovalFlowStage } from "../requests/ApprovalFlowMap";

import type { LoanRequest } from "../../services/api/loanApi";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

function isRejectedAtStage(request: LoanRequest, stage: "manager" | "hr" | "cfo" | "ceo") {
  if (request.status !== "rejected") return false;
  if (stage === "manager") return Boolean(request.manager_decision_note && !request.finance_decision_note && !request.cfo_decision_note && !request.ceo_decision_note);
  if (stage === "hr") return Boolean(request.finance_decision_note && !request.cfo_decision_note && !request.ceo_decision_note);
  if (stage === "cfo") return Boolean(request.cfo_decision_note && !request.ceo_decision_note);
  return Boolean(request.ceo_decision_note);
}

function buildStages(request: LoanRequest, t: TranslateFn): ApprovalFlowStage[] {
  const needsManager = request.status === "pending_manager" || Boolean(request.manager_decision_at || request.manager_decision_note);
  const needsCeo = request.status === "pending_ceo" || Boolean(request.ceo_decision_at || request.ceo_decision_note);
  const wentToDisbursement =
    request.status === "pending_disbursement" || request.status === "approved" || request.status === "deducted" || Boolean(request.disbursed_at);

  const managerState: ApprovalFlowStage["state"] = !needsManager
    ? "skipped"
    : isRejectedAtStage(request, "manager")
      ? "rejected"
      : request.manager_decision_at
        ? "completed"
        : request.status === "pending_manager"
          ? "current"
          : "upcoming";

  const hrState: ApprovalFlowStage["state"] = isRejectedAtStage(request, "hr")
    ? "rejected"
    : request.finance_decision_at
      ? "completed"
      : request.status === "pending_hr" || request.status === "pending_finance"
        ? "current"
        : needsManager && !request.manager_decision_at
          ? "upcoming"
          : "upcoming";

  const cfoState: ApprovalFlowStage["state"] = isRejectedAtStage(request, "cfo")
    ? "rejected"
    : request.cfo_decision_at
      ? "completed"
      : request.status === "pending_cfo"
        ? "current"
        : request.finance_decision_at || request.status === "pending_ceo" || wentToDisbursement
          ? "upcoming"
          : "upcoming";

  const ceoState: ApprovalFlowStage["state"] = !needsCeo
    ? "skipped"
    : isRejectedAtStage(request, "ceo")
      ? "rejected"
      : request.ceo_decision_at
        ? "completed"
        : request.status === "pending_ceo"
          ? "current"
          : wentToDisbursement
            ? "completed"
            : "upcoming";

  const disbursementState: ApprovalFlowStage["state"] =
    request.status === "deducted"
      ? "completed"
      : request.status === "approved" || request.status === "pending_disbursement"
        ? "current"
        : request.disbursed_at
          ? "completed"
          : request.status === "rejected" || request.status === "cancelled"
            ? "upcoming"
            : "upcoming";

  return [
    {
      key: "submitted",
      title: t("loans.approvalMap.submitted"),
      state: "completed",
      note: t("loans.approvalMap.requestSent"),
      at: request.created_at,
    },
    {
      key: "manager",
      title: t("loans.approvalMap.managerReview"),
      state: managerState,
      note:
        managerState === "skipped"
          ? t("loans.approvalMap.notRequired")
          : request.manager_decision_note || t(`loans.approvalMap.${managerState}`),
      at: request.manager_decision_at,
    },
    {
      key: "hr",
      title: t("loans.approvalMap.hrReview"),
      state: hrState,
      note:
        request.finance_decision_note ||
        (hrState === "completed" ? t("loans.approvalMap.forwarded") : t(`loans.approvalMap.${hrState}`)),
      at: request.finance_decision_at,
    },
    {
      key: "cfo",
      title: t("loans.approvalMap.cfoReview"),
      state: cfoState,
      note: request.cfo_decision_note || t(`loans.approvalMap.${cfoState}`),
      at: request.cfo_decision_at,
    },
    {
      key: "ceo",
      title: t("loans.approvalMap.ceoReview"),
      state: ceoState,
      note:
        ceoState === "skipped"
          ? t("loans.approvalMap.notRequired")
          : request.ceo_decision_note || t(`loans.approvalMap.${ceoState}`),
      at: request.ceo_decision_at,
    },
    {
      key: "disbursement",
      title: t("loans.approvalMap.disbursement"),
      state: disbursementState,
      note:
        request.disbursement_note ||
        (request.status === "deducted" ? t("loans.approvalMap.deducted") : t(`loans.approvalMap.${disbursementState}`)),
      at: request.disbursed_at || request.deducted_at,
    },
  ];
}

export default function LoanApprovalMap({ request, t }: { request: LoanRequest; t: TranslateFn }) {
  return <ApprovalFlowMap eyebrow={t("loans.approvalMap.eyebrow")} title={t("loans.approvalMap.title")} stages={buildStages(request, t)} t={t} />;
}
