import React, { useEffect, useRef, useState } from "react";
import { Button, Card, DatePicker, Divider, Input, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import PageHeader from "../../components/ui/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import ApprovalActions from "../../components/ceo/ApprovalActions";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import {
  approveCEOAttendance,
  getCEOAttendance,
  getGlobalAttendance,
  rejectCEOAttendance,
} from "../../services/api/attendanceApi";
import type { AttendanceListResponse } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import type { AttendanceRecord, AttendanceStatus } from "../../types/attendance";
import { unwrapEnvelope, normalizeListData } from "../../utils/dataUtils";
import { formatDateOnly, formatTimeOnly } from "../../utils/dateTime";
import { useI18n } from "../../i18n/useI18n";

const { RangePicker } = DatePicker;
const { Text } = Typography;

type PreviewRole = "hr" | "ceo";

interface AttendancePreviewPageProps {
  role: PreviewRole;
}

const STATUS_OPTIONS: AttendanceStatus[] = [
  "PRESENT",
  "LATE",
  "ABSENT",
  "PENDING",
  "PENDING_HR",
  "PENDING_MGR",
  "PENDING_CEO",
  "REJECTED",
];

const statusColors: Record<AttendanceStatus, string> = {
  PRESENT: "green",
  ABSENT: "red",
  LATE: "gold",
  PENDING: "orange",
  PENDING_HR: "orange",
  PENDING_MGR: "gold",
  PENDING_CEO: "purple",
  REJECTED: "magenta",
};

const sourceColors: Record<string, string> = {
  EMPLOYEE: "blue",
  HR: "geekblue",
  SYSTEM: "default",
};

const SEARCH_DEBOUNCE_MS = 400;

const AttendancePreviewPage: React.FC<AttendancePreviewPageProps> = ({ role }) => {
  const { language, t } = useI18n();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<Partial<Record<AttendanceStatus, number>>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [status, setStatus] = useState<AttendanceStatus | "ALL">("ALL");
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().subtract(13, "day"),
    dayjs(),
  ]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

  // CEO-only decision state. HR opens the same screen read-only.
  const isCeoApprover = role === "ceo";
  const [approvingRecord, setApprovingRecord] = useState<AttendanceRecord | null>(null);
  const [rejectingRecord, setRejectingRecord] = useState<AttendanceRecord | null>(null);
  const [deciding, setDeciding] = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      setPagination((current) => ({ ...current, current: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page: pagination.current,
        page_size: pagination.pageSize,
      };

      if (status !== "ALL") params.status = status;
      if (dateRange) {
        params.date_from = dateRange[0].format("YYYY-MM-DD");
        params.date_to = dateRange[1].format("YYYY-MM-DD");
      }
      if (search) params.search = search;

      const response = role === "ceo" ? await getCEOAttendance(params) : await getGlobalAttendance(params);
      const data = unwrapEnvelope(response) as AttendanceListResponse & {
        summary?: Partial<Record<AttendanceStatus, number>>;
      };
      const normalized = normalizeListData<AttendanceRecord>(data);
      setRecords(normalized.items);
      setTotal(normalized.total);
      setSummary(data.summary || {});
      setErrorMessage(null);
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message || t("attendancePreview.loadFailed");
      setErrorMessage(msg);
      setRecords([]);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize, status, dateRange, search]);

  const handleStatusChange = (value: AttendanceStatus | "ALL") => {
    setStatus(value);
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const handleRangeChange = (value: [dayjs.Dayjs, dayjs.Dayjs] | null) => {
    setDateRange(value);
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const handleReset = () => {
    setStatus("ALL");
    setDateRange([dayjs().subtract(13, "day"), dayjs()]);
    setSearchInput("");
    setSearch("");
    setPagination({ current: 1, pageSize: 20 });
  };

  const isFiltered =
    status !== "ALL" || search !== "" || dateRange === null || !dateRange[0].isSame(dayjs().subtract(13, "day"), "day");

  const rangePresets = [
    { label: t("attendancePreview.range.today"), value: [dayjs(), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs] },
    {
      label: t("attendancePreview.range.yesterday"),
      value: [dayjs().subtract(1, "day"), dayjs().subtract(1, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
    },
    {
      label: t("attendancePreview.range.thisWeek"),
      value: [dayjs().startOf("week"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
    },
    {
      label: t("attendancePreview.range.thisMonth"),
      value: [dayjs().startOf("month"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
    },
  ];

  const getStatusLabel = (value: AttendanceStatus) => {
    const keyByStatus: Record<AttendanceStatus, string> = {
      PRESENT: "attendancePreview.status.present",
      ABSENT: "attendancePreview.status.absent",
      LATE: "attendancePreview.status.late",
      PENDING: "attendancePreview.status.pending",
      PENDING_HR: "attendancePreview.status.pendingHr",
      PENDING_MGR: "attendancePreview.status.pendingManager",
      PENDING_CEO: "attendancePreview.status.pendingCeo",
      REJECTED: "attendancePreview.status.rejected",
    };
    return t(keyByStatus[value], value);
  };

  const getSourceLabel = (value: string) => {
    const keyBySource: Record<string, string> = {
      EMPLOYEE: "attendancePreview.source.employee",
      HR: "attendancePreview.source.hr",
      SYSTEM: "attendancePreview.source.system",
    };
    return keyBySource[value] ? t(keyBySource[value], value) : value;
  };

  const getEmployeeName = (record: AttendanceRecord) => {
    if (language === "ar") {
      return (
        record.employee_name_ar ||
        record.employee_name ||
        record.employee_name_en ||
        `${t("common.employee")} #${record.employee_profile}`
      );
    }
    return record.employee_name_en || record.employee_name || `${t("common.employee")} #${record.employee_profile}`;
  };

  const handleApprove = async (record: AttendanceRecord) => {
    setApprovingRecord(record);
    setDeciding(true);
    try {
      const response = await approveCEOAttendance(record.id, {});
      if (isApiError(response)) {
        message.error(response.message || t("attendancePreview.decision.failed"));
        return;
      }
      message.success(t("attendancePreview.decision.approved"));
      await fetchRecords();
    } catch (error: any) {
      message.error(error?.message || t("attendancePreview.decision.failed"));
    } finally {
      setDeciding(false);
      setApprovingRecord(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectingRecord) return;
    setDeciding(true);
    try {
      const response = await rejectCEOAttendance(rejectingRecord.id, { notes: reason });
      if (isApiError(response)) {
        message.error(response.message || t("attendancePreview.decision.failed"));
        return;
      }
      message.success(t("attendancePreview.decision.rejected"));
      setRejectingRecord(null);
      await fetchRecords();
    } catch (error: any) {
      message.error(error?.message || t("attendancePreview.decision.failed"));
    } finally {
      setDeciding(false);
    }
  };

  const pendingTotal =
    (summary.PENDING || 0) + (summary.PENDING_HR || 0) + (summary.PENDING_MGR || 0) + (summary.PENDING_CEO || 0);

  const summaryItems: Array<{ label: string; value: number; color: string }> = [
    { label: t("attendancePreview.summary.total"), value: total, color: "#0f172a" },
    { label: t("attendancePreview.status.present"), value: summary.PRESENT || 0, color: "#10b981" },
    { label: t("attendancePreview.status.late"), value: summary.LATE || 0, color: "#f59e0b" },
    { label: t("attendancePreview.status.absent"), value: summary.ABSENT || 0, color: "#ef4444" },
    { label: t("attendancePreview.status.pending"), value: pendingTotal, color: "#f97316" },
    { label: t("attendancePreview.status.rejected"), value: summary.REJECTED || 0, color: "#d946ef" },
  ];

  const columns: ColumnsType<AttendanceRecord> = [
    {
      title: t("common.employee"),
      key: "employee",
      width: 240,
      render: (_: unknown, record: AttendanceRecord) => (
        <Space direction="vertical" size={0} style={{ maxWidth: 220 }}>
          <Text strong ellipsis={{ tooltip: getEmployeeName(record) }} style={{ maxWidth: 220 }}>
            {getEmployeeName(record)}
          </Text>
          <Text
            type="secondary"
            ellipsis={{ tooltip: record.employee_email || t("attendancePreview.noEmail") }}
            style={{ fontSize: 12, maxWidth: 220 }}
          >
            {record.employee_email || t("attendancePreview.noEmail")}
          </Text>
        </Space>
      ),
    },
    {
      title: t("common.date"),
      dataIndex: "date",
      key: "date",
      width: 120,
      render: (value: string) => formatDateOnly(value),
    },
    {
      title: t("attendance.checkIn"),
      dataIndex: "check_in_at",
      key: "check_in_at",
      width: 100,
      render: (value: string | null) => formatTimeOnly(value, "-"),
    },
    {
      title: t("attendance.checkOut"),
      dataIndex: "check_out_at",
      key: "check_out_at",
      width: 100,
      render: (value: string | null) => formatTimeOnly(value, "-"),
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 150,
      render: (value: AttendanceStatus) => <Tag color={statusColors[value]}>{getStatusLabel(value)}</Tag>,
    },
    {
      title: t("hr.attendance.source"),
      dataIndex: "source",
      key: "source",
      width: 140,
      render: (value: string) => <Tag color={sourceColors[value] || "default"}>{getSourceLabel(value)}</Tag>,
    },
    // Only the CEO can clear PENDING_CEO rows, so the column appears for that
    // role alone and stays empty on rows waiting elsewhere in the chain.
    ...(isCeoApprover
      ? ([
          {
            title: t("common.actions"),
            key: "actions",
            width: 210,
            render: (_: unknown, record: AttendanceRecord) =>
              record.status === "PENDING_CEO" ? (
                <ApprovalActions
                  subjectLabel={getEmployeeName(record)}
                  approveLoading={deciding && approvingRecord?.id === record.id}
                  disabled={deciding}
                  onApprove={() => void handleApprove(record)}
                  onReject={() => setRejectingRecord(record)}
                />
              ) : (
                <Text type="secondary">{t("attendancePreview.decision.noActionNeeded")}</Text>
              ),
          },
        ] as ColumnsType<AttendanceRecord>)
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={isCeoApprover ? t("ceo.attendance.title") : t("hr.attendance.recordsTitle")}
        subtitle={isCeoApprover ? t("ceo.attendance.subtitle") : t("attendancePreview.subtitle")}
        actions={
          <Button icon={<ReloadOutlined />} onClick={fetchRecords} loading={loading}>
            {t("common.refresh")}
          </Button>
        }
      />

      <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          {summaryItems.map((item, idx) => (
            <React.Fragment key={item.label}>
              <div style={{ minWidth: 96 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: 4,
                  }}
                >
                  {item.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
              </div>
              {idx < summaryItems.length - 1 && <Divider type="vertical" style={{ height: "auto", margin: 0 }} />}
            </React.Fragment>
          ))}
        </div>
      </Card>

      <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div className="responsive-filter-bar" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
            placeholder={t("attendancePreview.filters.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ flex: "1 1 240px", minWidth: 200 }}
          />
          <RangePicker
            style={{ flex: "0 1 300px", minWidth: 240 }}
            value={dateRange}
            onChange={(value) => handleRangeChange(value && value[0] && value[1] ? [value[0], value[1]] : null)}
            presets={rangePresets}
            placeholder={[t("leave.startDate"), t("leave.endDate")]}
          />
          <Button onClick={handleReset} disabled={!isFiltered}>
            {t("common.reset")}
          </Button>
        </div>

        <Divider style={{ margin: "14px 0" }} />

        <Space size={[8, 8]} wrap>
          <Tag.CheckableTag checked={status === "ALL"} onChange={() => handleStatusChange("ALL")}>
            {t("attendancePreview.filters.statusAll")}
          </Tag.CheckableTag>
          {STATUS_OPTIONS.map((value) => (
            <Tag.CheckableTag key={value} checked={status === value} onChange={() => handleStatusChange(value)}>
              {getStatusLabel(value)}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>

      {errorMessage ? (
        <ErrorState title={t("attendancePreview.error.title")} description={errorMessage} onRetry={fetchRecords} />
      ) : !loading && records.length === 0 ? (
        <EmptyState
          title={t("attendancePreview.empty.title")}
          description={t("attendancePreview.empty.description")}
        />
      ) : (
        <Card size="small" style={{ borderRadius: 12 }}>
          <Table
            dataSource={records}
            columns={columns}
            rowKey="id"
            loading={loading}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total,
              showSizeChanger: true,
              onChange: (current, pageSize) => setPagination({ current, pageSize }),
            }}
          />
        </Card>
      )}

      {isCeoApprover && (
        <RejectReasonModal
          open={Boolean(rejectingRecord)}
          title={t("attendancePreview.decision.rejectTitle")}
          subject={rejectingRecord ? getEmployeeName(rejectingRecord) : undefined}
          loading={deciding}
          onCancel={() => setRejectingRecord(null)}
          onSubmit={handleReject}
        />
      )}
    </div>
  );
};

export default AttendancePreviewPage;
