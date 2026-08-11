import CeoAssetApprovalPage from "../../components/ceo/CeoAssetApprovalPage";
import { useI18n } from "../../i18n/useI18n";
import {
  approveCEOAssetDamageReport,
  getCEOAssetDamageReports,
  rejectCEOAssetDamageReport,
  type AssetDamageReport,
} from "../../services/api/assetsApi";

export default function CEOAssetDamageReportsPage() {
  const { t } = useI18n();

  return (
    <CeoAssetApprovalPage<AssetDamageReport>
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
    />
  );
}
