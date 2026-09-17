import { Descriptions, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { WarningOutlined } from "@ant-design/icons";

import { useI18n } from "../../i18n/useI18n";
import type {
  FullContractRating,
  RatingComparisonRow,
  RatingCriterion,
} from "../../services/api/contractRatingsApi";
import { GradeTag } from "./RatingResponseDetails";
import { criterionLabel } from "./ratingHelpers";

const { Text } = Typography;

/**
 * Points of difference at which a row is highlighted. Decision support only:
 * nothing in the workflow reacts to it.
 */
export const SIGNIFICANT_SCORE_DIFFERENCE = 15;

function isComparisonRow(value: unknown): value is RatingComparisonRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "manager_score" in value &&
    "employee_score" in value
  );
}

type Row = { criterion: RatingCriterion; data: RatingComparisonRow };

/**
 * HR/CEO-only side-by-side comparison of the manager's evaluation and the
 * employee's self-evaluation. It requires the full HR/CEO package type, so it
 * cannot be fed a manager- or employee-shaped payload.
 */
export default function RatingComparisonView({
  rating,
  criteria,
}: {
  rating: FullContractRating;
  criteria: RatingCriterion[];
}) {
  const { t, language } = useI18n();
  const summary = rating.comparison_summary ?? {};
  const rows: Row[] = [...criteria]
    .sort((a, b) => a.display_order - b.display_order)
    .map((criterion) => ({ criterion, data: summary[criterion.code] }))
    .filter((row): row is Row => isComparisonRow(row.data));

  if (!rows.length) {
    return (
      <Text type="secondary">{t("contractRatings.comparisonUnavailable")}</Text>
    );
  }

  const columns: ColumnsType<Row> = [
    {
      title: t("contractRatings.criterion"),
      key: "criterion",
      render: (_, row) =>
        criterionLabel(row.criterion, row.criterion.code, language),
    },
    {
      title: t("contractRatings.managerColumn"),
      key: "manager",
      render: (_, row) => (
        <Space size={4}>
          <GradeTag grade={row.data.manager_grade} />
          <Text strong>{row.data.manager_score}</Text>
        </Space>
      ),
    },
    {
      title: t("contractRatings.employeeColumn"),
      key: "employee",
      render: (_, row) => (
        <Space size={4}>
          <GradeTag grade={row.data.employee_grade} />
          <Text strong>{row.data.employee_score}</Text>
        </Space>
      ),
    },
    {
      title: t("contractRatings.difference"),
      key: "difference",
      render: (_, row) => {
        const diff = row.data.difference;
        const significant = Math.abs(diff) >= SIGNIFICANT_SCORE_DIFFERENCE;
        const text = diff > 0 ? `+${diff}` : String(diff);
        return significant ? (
          <Tag color="volcano" icon={<WarningOutlined aria-hidden />}>
            {text}
          </Tag>
        ) : (
          <Text>{text}</Text>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Table
        size="small"
        rowKey={(row) => row.criterion.code}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        onRow={(row) =>
          Math.abs(row.data.difference) >= SIGNIFICANT_SCORE_DIFFERENCE
            ? { style: { background: "#fff7e6" } }
            : {}
        }
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("contractRatings.differenceHint", {
          points: String(SIGNIFICANT_SCORE_DIFFERENCE),
        })}
      </Text>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label={t("contractRatings.managerAverage")}>
          <Space size={4}>
            <Text strong>{summary.manager_average ?? "—"}</Text>
            <GradeTag grade={summary.manager_overall_grade} />
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.employeeAverage")}>
          <Space size={4}>
            <Text strong>{summary.employee_average ?? "—"}</Text>
            <GradeTag grade={summary.employee_overall_grade} />
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}
