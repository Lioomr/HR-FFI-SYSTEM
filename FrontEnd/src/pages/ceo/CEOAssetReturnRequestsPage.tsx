import AssetReturnApprovalMap from "../../components/assets/AssetReturnApprovalMap";
import CeoAssetApprovalPage from "../../components/ceo/CeoAssetApprovalPage";
import { useI18n } from "../../i18n/useI18n";
import {
  approveCEOAssetReturnRequest,
  getCEOAssetReturnRequests,
  rejectCEOAssetReturnRequest,
  type AssetReturnRequest,
} from "../../services/api/assetsApi";

export default function CEOAssetReturnRequestsPage() {
  const { t } = useI18n();

  return (
    <CeoAssetApprovalPage<AssetReturnRequest>
      title={t("assets.returnRequests", "Return Requests")}
      subtitle={t("ceo.assets.returnSubtitle")}
      emptyTitle={t("ceo.assets.returnEmpty")}
      rejectTitle={t("ceo.assets.returnRejectTitle")}
      detailColumn={{
        title: t("common.notes"),
        render: (record) => record.note,
      }}
      fetcher={getCEOAssetReturnRequests}
      approve={approveCEOAssetReturnRequest}
      reject={rejectCEOAssetReturnRequest}
      // The return flow passes through manager and HR before the CEO, so the
      // map is worth keeping: it shows what has already been decided.
      expandedRowRender={(record) => <AssetReturnApprovalMap request={record} t={t} />}
    />
  );
}
