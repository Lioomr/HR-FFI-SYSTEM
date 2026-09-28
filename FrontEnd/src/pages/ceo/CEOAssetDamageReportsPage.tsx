import CeoAssetApprovalPage from "../../components/ceo/CeoAssetApprovalPage";
import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../../components/requests/ApprovalFlowMap";
import { useI18n } from "../../i18n/useI18n";
import {
  approveCEOAssetDamageReport,
  getCEOAssetDamageReports,
  rejectCEOAssetDamageReport,
  type AssetDamageReport,
} from "../../services/api/assetsApi";

/** The serializer also returns when each reviewer decided. */
type DamageReportRow = AssetDamageReport & {
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

  return [
    {
      key: "reported",
      title: t("assets.damageApprovalMap.reported", "Reported"),
      state: "completed",
      note: t(
        "assets.damageApprovalMap.reportSent",
        "Damage report submitted.",
      ),
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
      at: report.hr_decision_at,
    },
    {
      key: "ceo",
      title: t("assets.approvalMap.ceoReview", "CEO Review"),
      state: ceoState,
      note: report.ceo_decision_note || t(`leave.approvalMap.${ceoState}`),
      at: report.ceo_decision_at,
    },
  ];
}

export default function CEOAssetDamageReportsPage() {
  const { t } = useI18n();

  return (
    <CeoAssetApprovalPage<DamageReportRow>
      title={t("assets.damageReports", "Damage Reports")}
      subtitle={t("ceo.assets.damageSubtitle")}
      emptyTitle={t("ceo.assets.damageEmpty")}
      rejectTitle={t("ceo.assets.damageRejectTitle")}
      detailColumn={{
        title: t("common.description"),
        render: (record) => record.description,
      }}
      fetcher={getCEOAssetDamageReports}
      approve={approveCEOAssetDamageReport}
      reject={rejectCEOAssetDamageReport}
      employeeProfilePath={(employeeProfileId) =>
        `/manager/team/${employeeProfileId}`
      }
      // Shows whether HR already reviewed the report before it reached the CEO.
      expandedRowRender={(record) => (
        <ApprovalFlowMap
          eyebrow={t(
            "assets.damageApprovalMap.eyebrow",
            "Damage Report Workflow",
          )}
          title={t("assets.approvalMap.title", "Approval Progress")}
          stages={buildStages(record, t)}
          t={t}
        />
      )}
    />
  );
}
