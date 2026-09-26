import React, { useCallback, useEffect, useMemo } from "react";
import { Alert, Button, DatePicker, Tabs, Tag, Tooltip, message } from "antd";
import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FileDoneOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  TableOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/ui/PageHeader";
import ResponsiveTable from "../../components/ui/ResponsiveTable";
import { WorkspaceCard } from "../../components/ui/workspace/Workspace";
import TodayAttendanceSummaryCard from "../../components/attendance/TodayAttendanceSummaryCard";
import MyAttendanceViolations from "../../components/attendance/MyAttendanceViolations";
import MyAttendanceNotices from "../../components/attendance/MyAttendanceNotices";
import { useEmployeeAttendanceStore } from "../../stores/attendanceStore";
import type {
  AttendanceRecord,
  EffectiveAttendanceStatus,
} from "../../types/attendance";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatTimeOnly12 } from "../../utils/dateTime";
// Same summary cards as the HR attendance records page.
import "../shared/AttendancePreviewPage.css";

const { RangePicker } = DatePicker;

const DEFAULT_RANGE_DAYS = 30;

const STATUS_COLOR: Record<EffectiveAttendanceStatus, string> = {
  PRESENT: "green",
  ABSENT: "red",
  LATE: "orange",
  EXCUSED: "blue",
  PENDING: "gold",
  PENDING_HR: "gold",
  PENDING_MGR: "gold",
  PENDING_CEO: "gold",
  REJECTED: "magenta",
};

const STATUS_LABEL_KEY: Record<EffectiveAttendanceStatus, string> = {
  PRESENT: "attendancePreview.status.present",
  ABSENT: "attendancePreview.status.absent",
  LATE: "attendancePreview.status.late",
  EXCUSED: "attendancePreview.status.excused",
  PENDING: "attendancePreview.status.pending",
  PENDING_HR: "attendancePreview.status.pendingHr",
  PENDING_MGR: "attendancePreview.status.pendingManager",
  PENDING_CEO: "attendancePreview.status.pendingCeo",
  REJECTED: "attendancePreview.status.rejected",
};

const defaultRange = (): [dayjs.Dayjs, dayjs.Dayjs] => [
  dayjs().subtract(DEFAULT_RANGE_DAYS, "day"),
  dayjs(),
];

const EmployeeAttendancePage: React.FC = () => {
  const { t } = useI18n();
  const {
    records,
    total,
    summary,
    loading,
    error,
    fetchMyRecords,
    accessUnavailable,
  } = useEmployeeAttendanceStore();

  const [dateRange, setDateRange] =
    React.useState<[dayjs.Dayjs, dayjs.Dayjs]>(defaultRange);
  const [statusFilter, setStatusFilter] = React.useState<
    EffectiveAttendanceStatus | undefined
  >();
  const [activeTab, setActiveTab] = React.useState("records");
  const [pagination, setPagination] = React.useState({
    current: 1,
    pageSize: 10,
  });

  const currentFilters = useMemo(
    () => ({
      date_from: dateRange[0].format("YYYY-MM-DD"),
      date_to: dateRange[1].format("YYYY-MM-DD"),
      effective_status: statusFilter,
      page: pagination.current,
      page_size: pagination.pageSize,
    }),
    [dateRange, statusFilter, pagination],
  );

  const fetchData = useCallback(() => {
    fetchMyRecords(currentFilters);
  }, [fetchMyRecords, currentFilters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (error) {
      message.error(error);
    }
  }, [error]);

  const statusLabel = (status: EffectiveAttendanceStatus) =>
    t(STATUS_LABEL_KEY[status] ?? status, status);

  // Totals ignore the status filter only when none is set; with a filter the
  // backend narrows the summary too, so keep the last unfiltered totals.
  const [periodTotals, setPeriodTotals] = React.useState(summary);
  useEffect(() => {
    if (!statusFilter && !loading) setPeriodTotals(summary);
  }, [summary, statusFilter, loading]);

  const count = (status: EffectiveAttendanceStatus) =>
    periodTotals[status] || 0;
  const onTimeOrLate = count("PRESENT") + count("LATE");
  const accountable = onTimeOrLate + count("ABSENT");
  const ratePercent =
    accountable > 0 ? Math.round((onTimeOrLate / accountable) * 100) : 0;
  const periodTotal = Object.values(periodTotals).reduce<number>(
    (sum, value) => sum + (value || 0),
    0,
  );

  const metrics: Array<{
    status?: EffectiveAttendanceStatus;
    label: string;
    value: number;
    tone: string;
    icon: React.ReactNode;
  }> = [
    {
      label: t("attendancePreview.summary.total"),
      value: periodTotal,
      tone: "neutral",
      icon: <UnorderedListOutlined />,
    },
    {
      status: "PRESENT",
      label: statusLabel("PRESENT"),
      value: count("PRESENT"),
      tone: "positive",
      icon: <CheckCircleOutlined />,
    },
    {
      status: "LATE",
      label: statusLabel("LATE"),
      value: count("LATE"),
      tone: "warning",
      icon: <ClockCircleOutlined />,
    },
    {
      status: "ABSENT",
      label: statusLabel("ABSENT"),
      value: count("ABSENT"),
      tone: "critical",
      icon: <CloseCircleOutlined />,
    },
    {
      status: "EXCUSED",
      label: statusLabel("EXCUSED"),
      value: count("EXCUSED"),
      tone: "informational",
      icon: <FileDoneOutlined />,
    },
  ];

  const selectStatus = (status?: EffectiveAttendanceStatus) => {
    setStatusFilter((current) =>
      status === undefined || current === status ? undefined : status,
    );
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const rangePresets = [
    {
      label: t("attendancePreview.range.thisWeek"),
      value: [dayjs().startOf("week"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
    },
    {
      label: t("attendancePreview.range.thisMonth"),
      value: [dayjs().startOf("month"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
    },
    {
      label: t("attendancePreview.range.lastMonth", "Last month"),
      value: [
        dayjs().subtract(1, "month").startOf("month"),
        dayjs().subtract(1, "month").endOf("month"),
      ] as [dayjs.Dayjs, dayjs.Dayjs],
    },
  ];

  const columns = [
    {
      title: t("attendance.date"),
      dataIndex: "date",
      key: "date",
      width: 150,
      render: (val: string) => (
        <span style={{ whiteSpace: "nowrap" }}>
          {formatDateOnly(val)}{" "}
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            {dayjs(val).format("ddd")}
          </span>
        </span>
      ),
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 170,
      render: (status: EffectiveAttendanceStatus, record: AttendanceRecord) => {
        const effective = record.effective_status || status;
        return (
          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
            <Tag
              color={STATUS_COLOR[effective] ?? "default"}
              style={{ marginInlineEnd: 0 }}
            >
              {effective === "EXCUSED" && record.status === "LATE"
                ? t("attendancePreview.status.lateExcused")
                : statusLabel(effective)}
            </Tag>
            {/* `is_late_flagged` is the stable "was late" signal for a row still
                awaiting approval, where `status` only says PENDING_*. */}
            {record.is_late_flagged && status.startsWith("PENDING") ? (
              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                {t("attendancePreview.lateArrivalTag")}
              </Tag>
            ) : null}
            {record.notes ? (
              <Tooltip title={record.notes}>
                <InfoCircleOutlined
                  aria-label={t("attendance.notes")}
                  style={{ color: "var(--text-muted)", alignSelf: "center" }}
                />
              </Tooltip>
            ) : null}
          </span>
        );
      },
    },
    {
      title: t("attendance.timeInOut"),
      key: "time",
      width: 200,
      responsive: ["sm" as const],
      render: (_: unknown, record: AttendanceRecord) =>
        record.check_in_at || record.check_out_at ? (
          <span className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
            {formatTimeOnly12(record.check_in_at, "—")}
            <span style={{ color: "var(--text-muted)", marginInline: 6 }}>
              –
            </span>
            {formatTimeOnly12(record.check_out_at, "—")}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: t("attendancePreview.columns.lateBy"),
      dataIndex: "late_minutes",
      key: "late_minutes",
      width: 100,
      responsive: ["sm" as const],
      render: (val: number | undefined) =>
        val && val > 0 ? <span className="attendance-late">+{val}m</span> : "—",
    },
  ];

  const recordsView = (
    <>
      <section
        className="attendance-overview"
        aria-label={t("attendancePreview.overview")}
      >
        <div className="attendance-overview__layout">
          <div className="attendance-rate">
            <div
              className="attendance-rate__ring"
              style={{ "--rate": `${ratePercent}%` } as React.CSSProperties}
              aria-hidden="true"
            >
              <span className="attendance-rate__ring-inner" />
            </div>
            <div className="attendance-rate__body">
              <div className="attendance-rate__label">
                {t("attendancePreview.summary.attendanceRate")}
              </div>
              <div className="attendance-rate__value">
                {accountable > 0 ? `${ratePercent}%` : "—"}
              </div>
              <div className="attendance-rate__caption">
                {onTimeOrLate} / {accountable}
              </div>
            </div>
          </div>
          <div className="attendance-overview__grid attendance-overview__grid--compact">
            {metrics.map((item) => {
              const share =
                !item.status || periodTotal === 0
                  ? 100
                  : Math.round((item.value / periodTotal) * 100);
              return (
                <button
                  type="button"
                  key={item.label}
                  className={`attendance-metric attendance-metric--${item.tone}`}
                  aria-pressed={statusFilter === item.status}
                  onClick={() => selectStatus(item.status)}
                >
                  <span className="attendance-metric__top">
                    <span
                      className="attendance-metric__icon"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    <span className="attendance-metric__label">
                      {item.label}
                    </span>
                  </span>
                  <span className="attendance-metric__value">{item.value}</span>
                  <span className="attendance-metric__bar" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <WorkspaceCard
        toolbar={
          <RangePicker
            className="ffi-toolbar__field--wide"
            style={{ maxWidth: 420 }}
            value={dateRange}
            presets={rangePresets}
            allowClear={false}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
                setPagination((current) => ({ ...current, current: 1 }));
              }
            }}
          />
        }
        title={
          statusFilter
            ? statusLabel(statusFilter)
            : t("attendancePolicy.hr.tabRecords")
        }
        count={t("attendancePreview.resultsCount", { count: total })}
        busy={loading && records.length > 0}
      >
        <ResponsiveTable
          mobileCard={{ titleKey: "date", extraKey: "status" }}
          dataSource={records}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: "max-content" }}
          size="middle"
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: total,
            showSizeChanger: true,
            pageSizeOptions: ["10", "25", "50", "100"],
            showTotal: (count, range) =>
              `${t("common.showing")} ${range[0]}–${range[1]} ${t("common.of")} ${count}`,
            onChange: (page, pageSize) =>
              setPagination((current) => ({
                current: pageSize !== current.pageSize ? 1 : page,
                pageSize,
              })),
          }}
        />
      </WorkspaceCard>
    </>
  );

  return (
    <div className="attendance-page">
      <PageHeader
        title={t("attendance.myAttendance")}
        subtitle={t("attendance.biotimeNotice")}
        actions={
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            {t("common.refresh")}
          </Button>
        }
      />

      {accessUnavailable ? (
        <Alert type="info" showIcon title={t("attendance.unmapped")} />
      ) : (
        <>
          <TodayAttendanceSummaryCard />
          <Tabs
            className="ffi-pill-tabs"
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "records",
                icon: <TableOutlined aria-hidden="true" />,
                label: t("attendancePolicy.hr.tabRecords"),
                children: recordsView,
              },
              {
                key: "violations",
                icon: <WarningOutlined aria-hidden="true" />,
                label: t("attendancePolicy.hr.tabViolations"),
                children: <MyAttendanceViolations />,
              },
              {
                key: "notices",
                icon: <BellOutlined aria-hidden="true" />,
                label: t("attendancePolicy.hr.tabNotices"),
                children: <MyAttendanceNotices />,
              },
            ]}
          />
        </>
      )}
    </div>
  );
};

export default EmployeeAttendancePage;
