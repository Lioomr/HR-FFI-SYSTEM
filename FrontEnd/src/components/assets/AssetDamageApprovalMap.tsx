import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../requests/ApprovalFlowMap";
import {
  stageActorFromWorkflow,
  withCancellation,
} from "../requests/workflowPresentation";
import { useI18n } from "../../i18n/useI18n";
import type { AssetDamageReport } from "../../services/api/assetsApi";

/** The serializer also returns when each reviewer decided. */
export type DamageReportRow = AssetDamageReport & {
  hr_decision_at?: string | null;
  ceo_decision_at?: string | null;
};

type TranslateFn = ReturnType<typeof useI18n>["t"];

/**
 * Report → HR → CEO, from the recorded decision fields. An HR manager's own
 * report goes straight to the CEO, so HR without a decision is "not required".
 */
function buildStages(
  report: DamageReportRow,
  t: TranslateFn,
): ApprovalFlowStage[] {
  const hrState: ApprovalFlowStage["state"] = report.hr_decision_at
    ? "completed"
    : report.status === "PENDING_HR"
      ? "current"
      : "skipped";
  const ceoState: ApprovalFlowStage["state"] = report.ceo_decision_at
    ? report.status === "REJECTED"
      ? "rejected"
      : "completed"
    : report.status === "PENDING_CEO"
      ? "current"
      : "upcoming";

  const stages: ApprovalFlowStage[] = [
    {
      key: "reported",
      title: t("assets.damageApprovalMap.reported", "Reported"),
      state: "completed",
      note: t(
        "assets.damageApprovalMap.reportSent",
        "Damage report submitted.",
      ),
      actor:
        stageActorFromWorkflow(report.workflow, "reported") ??
        (report.employee_name
          ? { full_name: report.employee_name, email: report.employee_email }
          : null),
      at: report.reported_at,
    },
    {
      key: "hr",
      title: t("assets.approvalMap.hrReview", "HR Review"),
      state: hrState,
      note:
        hrState === "skipped"
          ? t("assets.approvalMap.notRequired", "Not required")
          : report.hr_decision_note || t(`leave.approvalMap.${hrState}`),
      actor: stageActorFromWorkflow(report.workflow, "hr"),
      at: report.hr_decision_at,
    },
    {
      key: "ceo",
      title: t("assets.approvalMap.ceoReview", "CEO Review"),
      state: ceoState,
      note: report.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      actor: stageActorFromWorkflow(report.workflow, "ceo"),
      at: report.ceo_decision_at,
    },
  ];
  return report.status === "CANCELLED"
    ? withCancellation(stages, report.workflow, t)
    : stages;
}

export default function AssetDamageApprovalMap({
  report,
}: {
  report: DamageReportRow;
}) {
  const { t } = useI18n();
  return (
    <ApprovalFlowMap
      eyebrow={t("assets.damageApprovalMap.eyebrow", "Damage Report Workflow")}
      title={t("assets.approvalMap.title", "Approval Progress")}
      stages={buildStages(report, t)}
      t={t}
    />
  );
}
