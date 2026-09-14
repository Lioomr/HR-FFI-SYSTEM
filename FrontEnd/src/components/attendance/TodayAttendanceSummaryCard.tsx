import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Skeleton,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
  LifecycleTag,
  PayrollStatusTag,
  PenaltyAmount,
} from "./AttendanceViolationsTable";
import { useI18n } from "../../i18n/useI18n";
import { getTodayAttendanceSummary } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../services/api/httpErrors";
import type {
  AttendanceDailyResult,
  AttendanceLateViolation,
} from "../../types/attendancePolicy";
import { formatDateOnly, formatTimeOnly } from "../../utils/dateTime";
import {
  GRACE_REASON_COLORS,
  classifyAttendanceAccessError,
  formatFractionAsPercent,
  formatMinutes,
  graceReasonLabel,
  isWarningOnlyViolation,
  violationLifecycleHint,
} from "../../utils/attendancePolicy";

const { Text } = Typography;

type SummaryState =
  | { kind: "loading" }
  | { kind: "ready"; result: AttendanceDailyResult }
  | { kind: "unmapped" }
  | { kind: "company" }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

/** Keeps clock times left-to-right inside Arabic text. */
function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" style={{ unicodeBidi: "isolate", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function ViolationNotice({
  violation,
}: {
  violation: AttendanceLateViolation;
}) {
  const { t } = useI18n();
  const warningOnly = isWarningOnlyViolation(violation);
  return (
    <Alert
      type={warningOnly ? "info" : "warning"}
      showIcon
      title={t("attendancePolicy.violation.titleWithOccurrence", {
        number: violation.occurrence_number,
      })}
      description={
        <Flex vertical gap={8}>
          {warningOnly ? (
            <Text>
              {violation.occurrence_number <= 1
                ? t("attendancePolicy.violation.warningOnly")
                : t("attendancePolicy.violation.noDeduction")}
            </Text>
          ) : (
            <Flex wrap gap={6} align="center">
              <Text>{t("attendancePolicy.violation.penalty")}:</Text>
              <PenaltyAmount amount={violation.penalty_amount} size={13} />
              <Text type="secondary">
                {t("attendancePolicy.violation.percentOfDailyRate", {
                  percent: formatFractionAsPercent(violation.penalty_percent),
                })}
              </Text>
            </Flex>
          )}
          <Flex wrap gap={12} align="center">
            <Flex gap={6} align="center">
              <Text type="secondary">
                {t("attendancePolicy.violation.lifecycle")}:
              </Text>
              <LifecycleTag violation={violation} />
            </Flex>
            <Flex gap={6} align="center">
              <Text type="secondary">
                {t("attendancePolicy.violation.payrollStatus")}:
              </Text>
              <PayrollStatusTag status={violation.payroll_status} />
            </Flex>
          </Flex>
          <Text type="secondary">{violationLifecycleHint(t, violation)}</Text>
        </Flex>
      }
    />
  );
}

function SummaryDetails({ result }: { result: AttendanceDailyResult }) {
  const { t } = useI18n();
  const late = result.status_input === "LATE";
  const reason = result.grace.reason;
  const notRecorded = t("attendancePolicy.today.notRecorded");
  const stats: Array<{ key: string; label: string; value: ReactNode }> = [
    {
      key: "firstCheckIn",
      label: t("attendancePolicy.today.firstCheckIn"),
      value: <Ltr>{formatTimeOnly(result.first_check_in_at, notRecorded)}</Ltr>,
    },
    {
      key: "finalCheckOut",
      label: t("attendancePolicy.today.finalCheckOut"),
      value: (
        <Ltr>{formatTimeOnly(result.final_check_out_at, notRecorded)}</Ltr>
      ),
    },
    {
      key: "worked",
      label: t("attendancePolicy.today.worked"),
      value: formatMinutes(t, result.physical_work_minutes),
    },
    {
      key: "unpaidBreak",
      label: t("attendancePolicy.today.unpaidBreak"),
      value: formatMinutes(t, result.unpaid_break_minutes),
    },
    {
      key: "approvedPermission",
      label: t("attendancePolicy.today.approvedPermission"),
      value: formatMinutes(t, result.approved_permission_minutes),
    },
    {
      key: "accounted",
      label: t("attendancePolicy.today.accounted"),
      value: formatMinutes(t, result.accounted_attendance_minutes),
    },
    {
      key: "missing",
      label: t("attendancePolicy.today.missing"),
      value: (
        <Text type={result.missing_minutes > 0 ? "danger" : undefined}>
          {formatMinutes(t, result.missing_minutes)}
        </Text>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={8} align="center">
        <Text type="secondary">{formatDateOnly(result.date)}</Text>
        <Tag color={late ? "orange" : "green"} style={{ marginInlineEnd: 0 }}>
          {t(`attendancePolicy.status.${result.status_input}`, {}, "")}
        </Tag>
        {result.is_attendance_exempt && (
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            {t("attendancePolicy.today.exempt")}
          </Tag>
        )}
        <Tag
          color={
            reason ? (GRACE_REASON_COLORS[reason] ?? "default") : "default"
          }
          style={{ marginInlineEnd: 0 }}
        >
          {graceReasonLabel(t, reason)}
        </Tag>
        {result.grace.consumed && (
          <Tag color="gold" style={{ marginInlineEnd: 0 }}>
            {t("attendancePolicy.grace.consumed")}
          </Tag>
        )}
      </Flex>

      <div>
        <Text type="secondary">{t("attendancePolicy.today.shift")}: </Text>
        <Ltr>
          {formatTimeOnly(result.shift.start_at)} –{" "}
          {formatTimeOnly(result.shift.end_at)}
        </Ltr>{" "}
        <Text type="secondary">
          ({formatMinutes(t, result.shift.scheduled_minutes)})
        </Text>
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 12,
          margin: 0,
        }}
      >
        {stats.map((stat) => (
          <div key={stat.key}>
            <dt style={{ fontSize: 12, color: "#64748b" }}>{stat.label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {result.violation && <ViolationNotice violation={result.violation} />}
    </Flex>
  );
}

/** Today's policy result for the signed-in employee. */
export default function TodayAttendanceSummaryCard() {
  const { t } = useI18n();
  const [state, setState] = useState<SummaryState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await getTodayAttendanceSummary();
      if (isApiError(response)) {
        setState({ kind: "error", message: response.message });
        return;
      }
      setState({ kind: "ready", result: response.data });
    } catch (error) {
      const problem = classifyAttendanceAccessError(error);
      if (problem === "other") {
        setState({ kind: "error", message: getHttpErrorMessage(error) });
      } else {
        setState({ kind: problem });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  let body: ReactNode;
  switch (state.kind) {
    case "loading":
      body = <Skeleton active paragraph={{ rows: 3 }} />;
      break;
    case "unmapped":
      body = <Alert type="info" showIcon title={t("attendance.unmapped")} />;
      break;
    case "company":
      body = (
        <Alert
          type="warning"
          showIcon
          title={t("attendancePolicy.today.companyRequired")}
          description={t("attendancePolicy.companyRequiredHint")}
        />
      );
      break;
    case "notFound":
      body = (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("attendancePolicy.today.notFound")}
        />
      );
      break;
    case "error":
      body = (
        <Alert
          type="error"
          showIcon
          title={t("attendancePolicy.today.loadFailed")}
          description={state.message}
        />
      );
      break;
    case "ready":
      body = <SummaryDetails result={state.result} />;
      break;
  }

  return (
    <Card
      title={t("attendancePolicy.today.title")}
      extra={
        <Button
          type="text"
          icon={<ReloadOutlined />}
          aria-label={`${t("common.refresh")}: ${t("attendancePolicy.today.title")}`}
          loading={state.kind === "loading"}
          onClick={() => void load()}
        />
      }
      style={{ marginBottom: 16, borderRadius: 12 }}
    >
      {body}
    </Card>
  );
}
