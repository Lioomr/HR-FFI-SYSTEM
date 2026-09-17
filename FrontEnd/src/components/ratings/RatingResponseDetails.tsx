import { Descriptions, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { useI18n } from "../../i18n/useI18n";
import {
  CONTRACT_SALARY_COMPONENTS,
  type ContractSalaryTerms,
} from "../../services/api/contractDecisionsApi";
import {
  type ContractRatingHeader,
  type ContractRatingStatus,
  type RatingCriterion,
  type RatingGrade,
  type RatingRecommendationFields,
  type RatingResponseBase,
} from "../../services/api/contractRatingsApi";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";

import {
  GRADE_COLORS,
  RATING_STATUS_COLORS,
  criterionLabel,
  formatPeriod,
} from "./ratingHelpers";

const { Text } = Typography;

export function RatingStatusTag({ status }: { status: ContractRatingStatus }) {
  const { t } = useI18n();
  return (
    <Tag color={RATING_STATUS_COLORS[status] ?? "default"}>
      {t(`contractRatings.status.${status}`, status)}
    </Tag>
  );
}

export function GradeTag({ grade }: { grade?: RatingGrade | "" | null }) {
  const { t } = useI18n();
  if (!grade) return <Text type="secondary">—</Text>;
  return (
    <Tag color={GRADE_COLORS[grade] ?? "default"}>
      {t(`contractRatings.gradeLabel.${grade}`, grade)}
    </Tag>
  );
}

export function SalaryTermsTags({
  terms,
}: {
  terms: ContractSalaryTerms | null | undefined;
}) {
  const { t } = useI18n();
  const fields = [...CONTRACT_SALARY_COMPONENTS, "total_salary" as const];
  const entries = fields
    .map((field) => [field, terms?.[field]] as const)
    .filter(([, value]) => value != null && value !== "");
  if (!entries.length) return <Text type="secondary">—</Text>;
  return (
    <Space wrap>
      {entries.map(([field, value]) => (
        <Tag key={field} color={field === "total_salary" ? "blue" : "default"}>
          {t(`contractDecisions.terms.${field}`)}: {value}
        </Tag>
      ))}
    </Space>
  );
}

/**
 * A single submitted response: its criterion answers and the server-computed
 * average and overall grade. It takes one response row, never a rating, so a
 * caller can only show a side it actually received from the API.
 */
export function RatingResponseDetails({
  response,
  criteria,
}: {
  response: RatingResponseBase;
  criteria: RatingCriterion[];
}) {
  const { t, language } = useI18n();
  const rows = [...criteria]
    .sort((a, b) => a.display_order - b.display_order)
    .map((criterion) => ({
      criterion,
      answer: response.criterion_ratings?.[criterion.code],
    }));

  const columns: ColumnsType<(typeof rows)[number]> = [
    {
      title: t("contractRatings.criterion"),
      key: "criterion",
      render: (_, row) =>
        criterionLabel(row.criterion, row.criterion.code, language),
    },
    {
      title: t("contractRatings.grade"),
      key: "grade",
      render: (_, row) => <GradeTag grade={row.answer?.grade} />,
    },
    {
      title: t("contractRatings.score"),
      key: "score",
      render: (_, row) => row.answer?.score ?? "—",
    },
    {
      title: t("contractRatings.remark"),
      key: "remark",
      responsive: ["md"],
      render: (_, row) => row.answer?.remark || "—",
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2, xl: 3 }}>
        <Descriptions.Item label={t("contractRatings.averageScore")}>
          <Text strong>{response.average_score}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.overallGrade")}>
          <GradeTag grade={response.overall_grade} />
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.responseStatus")}>
          <Tag color={response.status === "RETURNED" ? "volcano" : "green"}>
            {t(`contractRatings.responseStatusLabel.${response.status}`)}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.submittedBy")}>
          {response.submitted_by_name || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.submittedAt")}>
          {response.submitted_at
            ? formatDateTimeShort(response.submitted_at)
            : "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.overallRemark")}>
          {response.overall_remark || "—"}
        </Descriptions.Item>
      </Descriptions>
      <Table
        size="small"
        rowKey={(row) => row.criterion.code}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
      />
    </Space>
  );
}

/** The manager's recommendation and whichever change details it carries. */
export function RecommendationSummary({
  response,
  positionLabel,
}: {
  response: RatingRecommendationFields;
  positionLabel?: string;
}) {
  const { t } = useI18n();
  const types = response.recommended_change_types ?? [];
  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label={t("contractRatings.recommendation")}>
        {response.recommendation ? (
          <Tag
            color={response.recommendation === "TERMINATE" ? "red" : "blue"}
          >
            {t(
              `contractRatings.recommendationLabel.${response.recommendation}`,
            )}
          </Tag>
        ) : (
          "—"
        )}
      </Descriptions.Item>
      {types.length ? (
        <Descriptions.Item label={t("contractRatings.changeTypes")}>
          <Space wrap>
            {types.map((type) => (
              <Tag key={type}>
                {t(`contractRatings.changeTypeLabel.${type}`)}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
      ) : null}
      {types.includes("SALARY_INCREASE") ? (
        <Descriptions.Item label={t("contractRatings.proposedSalary")}>
          <SalaryTermsTags terms={response.proposed_terms} />
        </Descriptions.Item>
      ) : null}
      {response.proposed_job_title ? (
        <Descriptions.Item label={t("contractRatings.proposedJobTitle")}>
          {response.proposed_job_title}
        </Descriptions.Item>
      ) : null}
      {response.proposed_position_id ? (
        <Descriptions.Item label={t("contractRatings.proposedPosition")}>
          {positionLabel ?? `#${response.proposed_position_id}`}
        </Descriptions.Item>
      ) : null}
      {response.other_change_notes ? (
        <Descriptions.Item label={t("contractRatings.otherChangeNotes")}>
          {response.other_change_notes}
        </Descriptions.Item>
      ) : null}
    </Descriptions>
  );
}

/**
 * The employee/contract header every role's payload carries. Reads only
 * `ContractRatingHeader` keys, so it is safe for manager and employee views.
 */
export function RatingHeaderDetails({
  rating,
}: {
  rating: ContractRatingHeader;
}) {
  const { t } = useI18n();
  const { employee } = rating;
  return (
    <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 1, lg: 2, xl: 3 }}>
      <Descriptions.Item label={t("contractRatings.employee")}>
        {employee.full_name}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.employeeNumber")}>
        {employee.employee_number || employee.employee_id}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.department")}>
        {employee.department || "—"}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.section")}>
        {employee.section || "—"}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.jobTitle")}>
        {employee.job_title || "—"}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.manager")}>
        {rating.manager_name || "—"}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.contractStart")}>
        {formatDateOnly(rating.contract_date)}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.contractExpiry")}>
        {formatDateOnly(rating.contract_expiry)}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.evaluationPeriod")}>
        {formatPeriod(
          rating.evaluation_period_from,
          rating.evaluation_period_to,
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t("contractRatings.statusLabel")}>
        <RatingStatusTag status={rating.status} />
      </Descriptions.Item>
    </Descriptions>
  );
}
