import { Alert, Descriptions, Typography } from "antd";

import type { JobOffer } from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

/**
 * What the CEO decided, shown identically to HR and to the CEO.
 *
 * The reason is mandatory on a rejection or a change request and the
 * recommendation is optional on all three, so both are rendered only when the
 * backend actually recorded them.
 */
export default function JobOfferCeoDecision({ offer }: { offer: JobOffer }) {
  const { t } = useI18n();

  if (!offer.ceo_decision_at) {
    return (
      <Text type="secondary">
        {offer.approval_status === "pending_ceo"
          ? t("jobOffers.approval.awaitingDecision")
          : t("jobOffers.approval.notSubmitted")}
      </Text>
    );
  }

  const tone =
    offer.approval_status === "approved"
      ? "success"
      : offer.approval_status === "changes_requested"
        ? "warning"
        : "error";

  const heading =
    offer.approval_status === "approved"
      ? t("jobOffers.approval.approvedBy", {
          name: offer.ceo_decision_by_name || "—",
        })
      : offer.approval_status === "changes_requested"
        ? t("jobOffers.approval.changesRequestedBy", {
            name: offer.ceo_decision_by_name || "—",
          })
        : t("jobOffers.approval.rejectedBy", {
            name: offer.ceo_decision_by_name || "—",
          });

  return (
    <>
      <Alert
        type={tone}
        showIcon
        style={{ borderRadius: 12 }}
        message={heading}
        description={formatDateTimeShort(offer.ceo_decision_at, "—")}
      />
      {(offer.ceo_decision_reason || offer.ceo_recommendation) && (
        <Descriptions
          column={1}
          size="small"
          colon={false}
          style={{ marginTop: 12 }}
        >
          {offer.ceo_decision_reason ? (
            <Descriptions.Item label={t("jobOffers.approval.reason")}>
              {offer.ceo_decision_reason}
            </Descriptions.Item>
          ) : null}
          {offer.ceo_recommendation ? (
            <Descriptions.Item label={t("jobOffers.approval.recommendation")}>
              {offer.ceo_recommendation}
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      )}
    </>
  );
}
