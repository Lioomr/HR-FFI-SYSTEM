import { Flex, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ReactNode } from "react";
import ResponsiveTable from "../ui/ResponsiveTable";
import { SARIcon } from "../../utils/currency";
import { useI18n } from "../../i18n/useI18n";
import type {
  AttendanceDeductionStatus,
  AttendanceLateViolation,
  ViolationLifecycle,
} from "../../types/attendancePolicy";
import { formatDateOnly } from "../../utils/dateTime";
import {
  DEDUCTION_STATUS_COLORS,
  LIFECYCLE_COLORS,
  formatDecimalString,
  formatFractionAsPercent,
  graceReasonLabel,
  isWarningOnlyViolation,
  lifecycleLabel,
  payrollStatusLabel,
  violationEmployeeName,
  violationLifecycleHint,
  type ViolationHintSource,
} from "../../utils/attendancePolicy";

const { Text } = Typography;

/** Lifecycle label with a tooltip explaining what it means for this violation. */
export function LifecycleTag({
  violation,
}: {
  violation: ViolationHintSource;
}) {
  const { t } = useI18n();
  const hint = violationLifecycleHint(t, violation);
  const tag = (
    <Tag
      color={
        LIFECYCLE_COLORS[violation.lifecycle as ViolationLifecycle] ?? "default"
      }
      style={{ marginInlineEnd: 0 }}
    >
      {lifecycleLabel(t, violation.lifecycle)}
    </Tag>
  );
  return hint ? <Tooltip title={hint}>{tag}</Tooltip> : tag;
}

export function PayrollStatusTag({ status }: { status: string | null }) {
  const { t } = useI18n();
  return (
    <Tag
      color={
        status
          ? (DEDUCTION_STATUS_COLORS[status as AttendanceDeductionStatus] ??
            "default")
          : "default"
      }
      style={{ marginInlineEnd: 0 }}
    >
      {payrollStatusLabel(t, status)}
    </Tag>
  );
}

/** The server's decimal string as sent ("7.50"), never re-parsed as a float. */
export function PenaltyAmount({
  amount,
  size = 12,
}: {
  amount: string;
  size?: number;
}) {
  return (
    <Flex align="center" gap={4} style={{ whiteSpace: "nowrap" }}>
      <span
        dir="ltr"
        style={{
          unicodeBidi: "isolate",
          fontWeight: 600,
          color: "#cf1322",
          fontSize: size + 2,
        }}
      >
        {formatDecimalString(amount)}
      </span>
      <SARIcon size={size} color="#cf1322" />
    </Flex>
  );
}

/** Occurrence 1 is a zero-amount warning, so it never reads as a "0.00" penalty. */
export function ViolationPenalty({
  violation,
}: {
  violation: AttendanceLateViolation;
}) {
  const { t } = useI18n();
  if (isWarningOnlyViolation(violation)) {
    return (
      <Flex vertical gap={2}>
        <Tag color="blue" style={{ marginInlineEnd: 0, width: "fit-content" }}>
          {t("attendancePolicy.violation.warningTag")}
        </Tag>
        <Text type="secondary" style={{ fontSize: 12, maxWidth: 200 }}>
          {violation.occurrence_number <= 1
            ? t("attendancePolicy.violation.warningOnly")
            : t("attendancePolicy.violation.noDeduction")}
        </Text>
      </Flex>
    );
  }
  return (
    <Flex vertical gap={2}>
      <PenaltyAmount amount={violation.penalty_amount} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("attendancePolicy.violation.percentOfDailyRate", {
          percent: formatFractionAsPercent(violation.penalty_percent),
        })}
      </Text>
    </Flex>
  );
}

type Props = {
  items: AttendanceLateViolation[];
  loading: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number, pageSize: number) => void;
  /** HR view: adds the employee column and heads each phone card by employee. */
  showEmployee?: boolean;
  emptyText?: ReactNode;
};

export default function AttendanceViolationsTable({
  items,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  showEmployee = false,
  emptyText,
}: Props) {
  const { t, language } = useI18n();

  const columns: ColumnsType<AttendanceLateViolation> = [
    {
      title: t("common.date"),
      dataIndex: "date",
      key: "date",
      width: 120,
      render: (value: string) => formatDateOnly(value),
    },
    ...(showEmployee
      ? [
          {
            title: t("common.employee"),
            key: "employee",
            render: (_: unknown, record: AttendanceLateViolation) => (
              <Flex vertical gap={0}>
                <Text strong>{violationEmployeeName(record, language)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {record.employee_code}
                </Text>
              </Flex>
            ),
          },
        ]
      : []),
    {
      title: t("attendancePolicy.violation.occurrence"),
      key: "occurrence",
      width: 110,
      render: (_: unknown, record: AttendanceLateViolation) =>
        `#${record.occurrence_number}`,
    },
    {
      title: t("attendancePolicy.violation.penalty"),
      key: "penalty",
      render: (_: unknown, record: AttendanceLateViolation) => (
        <ViolationPenalty violation={record} />
      ),
    },
    {
      title: t("attendancePolicy.violation.lifecycle"),
      key: "lifecycle",
      render: (_: unknown, record: AttendanceLateViolation) => (
        <LifecycleTag violation={record} />
      ),
    },
    ...(showEmployee
      ? []
      : [
          {
            title: t("attendancePolicy.violation.meaning"),
            key: "meaning",
            render: (_: unknown, record: AttendanceLateViolation) => (
              <span style={{ display: "inline-block", maxWidth: 200 }}>
                {violationLifecycleHint(t, record)}
              </span>
            ),
          },
        ]),
    {
      title: t("attendancePolicy.violation.payrollStatus"),
      key: "payroll_status",
      render: (_: unknown, record: AttendanceLateViolation) => (
        <PayrollStatusTag status={record.payroll_status} />
      ),
    },
    {
      title: t("attendancePolicy.violation.reason"),
      key: "reason",
      render: (_: unknown, record: AttendanceLateViolation) => (
        <Flex vertical gap={0} style={{ maxWidth: 260 }}>
          <span>{graceReasonLabel(t, record.reason)}</span>
          {record.void_reason ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("attendancePolicy.violation.voidedBy", {
                reason: graceReasonLabel(t, record.void_reason),
              })}
            </Text>
          ) : null}
        </Flex>
      ),
    },
  ];

  return (
    <ResponsiveTable<AttendanceLateViolation>
      mobileCard={{
        titleKey: showEmployee ? "employee" : "date",
        extraKey: "lifecycle",
      }}
      rowKey="id"
      dataSource={items}
      columns={columns}
      loading={loading}
      size="small"
      scroll={{ x: "max-content" }}
      locale={emptyText ? { emptyText } : undefined}
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: onPageChange,
      }}
    />
  );
}
