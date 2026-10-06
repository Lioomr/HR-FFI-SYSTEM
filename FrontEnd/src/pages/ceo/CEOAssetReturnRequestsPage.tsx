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
        render: (record) => (
          <span>
            <strong>{record.reference_no || `#${record.id}`}</strong> · {record.note}
          </span>
        ),
      }}
      fetcher={getCEOAssetReturnRequests}
      approve={approveCEOAssetReturnRequest}
      reject={rejectCEOAssetReturnRequest}
      employeeProfilePath={(employeeProfileId) =>
        `/manager/team/${employeeProfileId}`
      }
      // The return flow passes through manager and HR before the CEO, so the
      // map is worth keeping: it shows what has already been decided.
      expandedRowRender={(record) => (
        <AssetReturnApprovalMap request={record} t={t} />
      )}
    />
  );
}
