import { Alert, Button, Descriptions, Space, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";

import SARIcon from "../icons/SARIcon";
import type { HiringRequest } from "../../services/api/hiringRequestsApi";
import { useI18n } from "../../i18n/useI18n";
import { formatNumber } from "../../utils/currency";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

/**
 * The approved request a job offer is being built from.
 *
 * Everything here is read-only on purpose: the backend re-copies the candidate
 * identity and the basic salary from the request when it creates the offer, so
 * an editable copy on this screen would be a field that silently does nothing.
 */
export default function HiringRequestSourcePanel({
  request,
  onDownloadCv,
  downloadingCv = false,
}: {
  request: HiringRequest;
  onDownloadCv?: () => void;
  downloadingCv?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: 24,
        marginBottom: 16,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        borderInlineStart: "4px solid #10b981",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>
          {t("jobOffers.source.title")}
        </Typography.Title>
      </div>

      <Alert
        type="success"
        showIcon
        style={{ borderRadius: 12, marginBottom: 16 }}
        message={t("jobOffers.source.approvedBy", {
          name: request.ceo_decision_by_name || "—",
        })}
        description={
          <>
            <div>
              {t("jobOffers.source.reference", { reference: request.reference_number })}
              {request.ceo_decision_at ? ` · ${formatDateTimeShort(request.ceo_decision_at)}` : ""}
            </div>
            {request.ceo_decision_note && (
              <div style={{ marginTop: 6 }}>{request.ceo_decision_note}</div>
            )}
          </>
        }
      />

      <Descriptions column={{ xs: 1, sm: 2 }} size="small" colon={false}>
        <Descriptions.Item label={t("jobOffers.field.candidateFullName")}>
          {request.candidate_full_name || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("jobOffers.field.candidateEmail")}>
          {request.candidate_email || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("jobOffers.field.candidatePhone")}>
          {request.candidate_phone_number || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("jobOffers.field.nationality")}>
          {request.nationality || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("hiringRequests.field.proposedSalary")}>
          <Space size={4}>
            <Text strong>{formatNumber(request.proposed_salary)}</Text>
            <SARIcon size={13} color="#475569" />
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t("hiringRequests.field.joiningCompany")}>
          {request.company_name || "—"}
        </Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {request.has_cv && onDownloadCv && (
          <Button
            icon={<DownloadOutlined aria-hidden />}
            loading={downloadingCv}
            onClick={onDownloadCv}
            style={{ borderRadius: 10 }}
          >
            {t("hiringRequests.action.downloadCv")}
          </Button>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("jobOffers.source.readOnlyHint")}
        </Text>
      </div>
    </div>
  );
}
