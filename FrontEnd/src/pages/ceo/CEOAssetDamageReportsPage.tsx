import CeoAssetApprovalPage from "../../components/ceo/CeoAssetApprovalPage";
import AssetDamageApprovalMap, {
  type DamageReportRow,
} from "../../components/assets/AssetDamageApprovalMap";
import { useI18n } from "../../i18n/useI18n";
import {
  approveCEOAssetDamageReport,
  getCEOAssetDamageReports,
  rejectCEOAssetDamageReport,
} from "../../services/api/assetsApi";

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
      expandedRowRender={(record) => <AssetDamageApprovalMap report={record} />}
    />
  );
}
