import { Alert, Descriptions, Tag, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";
import type {
  CeoOutcome,
  CeoOutcomeFields,
  FullContractRating,
} from "../../services/api/contractRatingsApi";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";
import { SalaryTermsTags } from "./RatingResponseDetails";

const { Text } = Typography;

const OUTCOME_COLORS: Record<CeoOutcome, string> = {
  RENEW: "green",
  RENEW_WITH_CHANGES: "blue",
  TERMINATE: "red",
};

export function CeoOutcomeTag({ decision }: { decision?: CeoOutcome | "" | null }) {
  const { t } = useI18n();
  if (!decision) return <Text type="secondary">—</Text>;
  return (
    <Tag color={OUTCOME_COLORS[decision]}>
      {t(`contractRatings.outcome.${decision}`, decision)}
    </Tag>
  );
}

/** The outcome keys shared by the coarse-HR and full payloads. */
type OutcomeSource = CeoOutcomeFields & {
  ceo_decided_by_name?: string;
  salary_before_snapshot?: FullContractRating["salary_before_snapshot"];
  salary_increase_amount?: string;
  salary_increase_percent?: string | null;
};

/**
 * Read-only CEO decision: the outcome, the applied salary change for Renew
 * with Increase, and the scheduled/processed termination for Terminate.
 */
export function RatingOutcomeDetails({
  outcome,
  contractExpiry,
}: {
  outcome: OutcomeSource;
  contractExpiry: string | null;
}) {
  const { t } = useI18n();
  const increase = outcome.ceo_decision === "RENEW_WITH_CHANGES";
  return (
    <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
      <Descriptions.Item label={t("contractRatings.ceoDecision")}>
        <CeoOutcomeTag decision={outcome.ceo_decision} />
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.ceoDecidedAt")}>
        {outcome.ceo_decided_at ? formatDateTimeShort(outcome.ceo_decided_at) : "—"}
      </Descriptions.Item>
      {outcome.ceo_decided_by_name !== undefined ? (
        <Descriptions.Item label={t("contractRatings.ceoDecidedBy")}>
          {outcome.ceo_decided_by_name || "—"}
        </Descriptions.Item>
      ) : null}
      <Descriptions.Item label={t("contractRatings.ceoComment")} span={2}>
        {outcome.ceo_comment || "—"}
      </Descriptions.Item>
      {increase ? (
        <>
          {outcome.salary_before_snapshot ? (
            <Descriptions.Item label={t("contractRatings.salaryBefore")} span={2}>
              <SalaryTermsTags terms={outcome.salary_before_snapshot} />
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label={t("contractRatings.ceoApprovedSalary")} span={2}>
            <SalaryTermsTags terms={outcome.ceo_approved_terms} />
          </Descriptions.Item>
          {outcome.salary_increase_amount !== undefined ? (
            <Descriptions.Item label={t("contractRatings.salaryIncrease")}>
              {outcome.salary_increase_amount}
              {outcome.salary_increase_percent != null
                ? ` (${outcome.salary_increase_percent}%)`
                : ""}
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label={t("contractRatings.salaryEffectiveDate")}>
            {formatDateOnly(outcome.salary_effective_date)}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.salaryApplied")} span={2}>
            {outcome.salary_change_applied_at ? (
              <>
                <Tag color="green">
                  {formatDateTimeShort(outcome.salary_change_applied_at)}
                </Tag>
                <SalaryTermsTags terms={outcome.salary_after_snapshot} />
              </>
            ) : (
              t("contractRatings.salaryNotApplied")
            )}
          </Descriptions.Item>
        </>
      ) : null}
      {outcome.scheduled_termination ? (
        <Descriptions.Item label={t("contractRatings.termination")} span={2}>
          {outcome.termination_processed_at
            ? t("contractRatings.terminationProcessedAt", {
                date: formatDateTimeShort(outcome.termination_processed_at),
              })
            : t("contractRatings.terminationScheduled", {
                date: formatDateOnly(contractExpiry),
              })}
        </Descriptions.Item>
      ) : null}
    </Descriptions>
  );
}

/** Server messages from a failed action, listed rather than swallowed. */
export function RatingActionErrors({ errors }: { errors: string[] }) {
  const { t } = useI18n();
  if (!errors.length) return null;
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message={t("contractRatings.validationTitle")}
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {errors.map((text, index) => (
            <li key={`${text}-${index}`}>{text}</li>
          ))}
        </ul>
      }
    />
  );
}
