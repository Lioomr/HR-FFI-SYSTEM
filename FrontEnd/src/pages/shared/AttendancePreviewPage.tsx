import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Card,
  DatePicker,
  Divider,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
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
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import type {
  AttendanceFilters,
  AttendanceRecord,
  AttendanceSource,
  AttendanceStatus,
} from "../../types/attendance";
import { unwrapEnvelope, normalizeListData } from "../../utils/dataUtils";
import {
  formatDateOnly,
  formatDurationBetween,
  formatTimeOnly,
} from "../../utils/dateTime";
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

const SOURCE_OPTIONS: AttendanceSource[] = ["SYSTEM", "EMPLOYEE", "HR"];

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
  SYSTEM: "cyan",
};

const SEARCH_DEBOUNCE_MS = 400;
const EMPLOYEE_SEARCH_DEBOUNCE_MS = 350;
const EMPLOYEE_OPTIONS_PAGE_SIZE = 50;
const DEFAULT_RANGE_DAYS = 13;

const defaultRange = (): [dayjs.Dayjs, dayjs.Dayjs] => [
  dayjs().subtract(DEFAULT_RANGE_DAYS, "day"),
  dayjs(),
];

const AttendancePreviewPage: React.FC<AttendancePreviewPageProps> = ({
  role,
}) => {
  const { language, t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;
  // The CEO endpoint only supports date_from/date_to, status and search.
  const supportsAdvancedFilters = role === "hr";

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<
    Partial<Record<AttendanceStatus, number>>
  >({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [status, setStatus] = useState<AttendanceStatus | "ALL">("ALL");
  const [source, setSource] = useState<AttendanceSource | "ALL">("ALL");
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(
    defaultRange(),
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState<number | undefined>(undefined);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

  const isCeoApprover = role === "ceo";
  const [approvingRecord, setApprovingRecord] = useState<AttendanceRecord | null>(null);
  const [rejectingRecord, setRejectingRecord] = useState<AttendanceRecord | null>(null);
  const [deciding, setDeciding] = useState(false);

  const [employeeOptionsSource, setEmployeeOptionsSource] = useState<
    Employee[]
  >([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeQueryInput, setEmployeeQueryInput] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const employeeDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const nextSearch = searchInput.trim();
      if (nextSearch !== search) {
        setSearch(nextSearch);
        setPagination((current) => ({ ...current, current: 1 }));
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput, search]);

  useEffect(() => {
    if (employeeDebounceRef.current) clearTimeout(employeeDebounceRef.current);
    employeeDebounceRef.current = setTimeout(() => {
      setEmployeeQuery(employeeQueryInput.trim());
    }, EMPLOYEE_SEARCH_DEBOUNCE_MS);
    return () => {
      if (employeeDebounceRef.current)
        clearTimeout(employeeDebounceRef.current);
    };
  }, [employeeQueryInput]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params: AttendanceFilters = {
        page: pagination.current,
        page_size: pagination.pageSize,
      };

      if (status !== "ALL") params.status = status;
      if (dateRange) {
        params.date_from = dateRange[0].format("YYYY-MM-DD");
        params.date_to = dateRange[1].format("YYYY-MM-DD");
      }
      if (search) params.search = search;
      if (supportsAdvancedFilters) {
        if (source !== "ALL") params.source = source;
        if (employeeId) params.employee_id = employeeId;
      }

      const response =
        role === "ceo"
          ? await getCEOAttendance(params)
          : await getGlobalAttendance(params);
      const data = unwrapEnvelope(response) as AttendanceListResponse & {
        summary?: Partial<Record<AttendanceStatus, number>>;
      };
      const normalized = normalizeListData<AttendanceRecord>(data);
      setRecords(normalized.items);
      setTotal(normalized.total);
      setSummary(data.summary || {});
      setErrorMessage(null);
    } catch (error: any) {
      const msg =
        error.response?.data?.message ||
        error.message ||
        translateRef.current("attendancePreview.loadFailed");
      setErrorMessage(msg);
      setRecords([]);
      setTotal(0);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [
    dateRange,
    employeeId,
    pagination,
    role,
    search,
    source,
    status,
    supportsAdvancedFilters,
  ]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    if (!supportsAdvancedFilters) return;
    let cancelled = false;
    setLoadingEmployees(true);
    listEmployees({
      search: employeeQuery || undefined,
      page_size: EMPLOYEE_OPTIONS_PAGE_SIZE,
    })
      .then((response) => {
        if (cancelled) return;
        const payload = unwrapEnvelope(response);
        setEmployeeOptionsSource(
          Array.isArray(payload?.results) ? payload.results : [],
        );
      })
      .catch(() => {
        if (!cancelled) setEmployeeOptionsSource([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEmployees(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeQuery, supportsAdvancedFilters]);

  const handleStatusChange = (value: AttendanceStatus | "ALL") => {
    setStatus(value);
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const handleSourceChange = (value: AttendanceSource | "ALL") => {
    setSource(value ?? "ALL");
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const handleEmployeeChange = (value: number | undefined) => {
    setEmployeeId(value);
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const handleRangeChange = (value: [dayjs.Dayjs, dayjs.Dayjs] | null) => {
    setDateRange(value);
    setPagination((current) => ({ ...current, current: 1 }));
  };

  const handleReset = () => {
    setStatus("ALL");
    setSource("ALL");
    setEmployeeId(undefined);
    setEmployeeQueryInput("");
    setEmployeeQuery("");
    setDateRange(defaultRange());
    setSearchInput("");
    setSearch("");
    setPagination({ current: 1, pageSize: 20 });
  };

  const isFiltered =
    status !== "ALL" ||
    source !== "ALL" ||
    employeeId !== undefined ||
    search !== "" ||
    dateRange === null ||
    !dateRange[0].isSame(dayjs().subtract(DEFAULT_RANGE_DAYS, "day"), "day");

  const rangePresets = [
    {
      label: t("attendancePreview.range.today"),
      value: [dayjs(), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
    },
    {
      label: t("attendancePreview.range.yesterday"),
      value: [dayjs().subtract(1, "day"), dayjs().subtract(1, "day")] as [
        dayjs.Dayjs,
        dayjs.Dayjs,
      ],
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
    return (
      record.employee_name_en ||
      record.employee_name ||
      `${t("common.employee")} #${record.employee_profile}`
    );
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

  const employeeOptions = useMemo(
    () =>
      employeeOptionsSource.map((employee) => {
        const localized =
          language === "ar" ? employee.full_name_ar : employee.full_name_en;
        const name =
          localized ||
          employee.full_name_en ||
          employee.full_name ||
          employee.email;
        return {
          value: employee.id,
          label: `${employee.employee_number || employee.employee_id} - ${name}`,
        };
      }),
    [employeeOptionsSource, language],
  );

  const pendingTotal =
    (summary.PENDING || 0) +
    (summary.PENDING_HR || 0) +
    (summary.PENDING_MGR || 0) +
    (summary.PENDING_CEO || 0);

  const summaryItems: Array<{ label: string; value: number; color: string }> = [
    {
      label: t("attendancePreview.summary.total"),
      value: total,
      color: "#0f172a",
    },
    {
      label: t("attendancePreview.status.present"),
      value: summary.PRESENT || 0,
      color: "#10b981",
    },
    {
      label: t("attendancePreview.status.late"),
      value: summary.LATE || 0,
      color: "#f59e0b",
    },
    {
      label: t("attendancePreview.status.absent"),
      value: summary.ABSENT || 0,
      color: "#ef4444",
    },
    {
      label: t("attendancePreview.status.pending"),
      value: pendingTotal,
      color: "#f97316",
    },
    {
      label: t("attendancePreview.status.rejected"),
      value: summary.REJECTED || 0,
      color: "#d946ef",
    },
  ];

  const columns: ColumnsType<AttendanceRecord> = [
    {
      title: t("common.employee"),
      key: "employee",
      width: 240,
      render: (_: unknown, record: AttendanceRecord) => (
        <Space direction="vertical" size={0} style={{ maxWidth: 220 }}>
          <Text
            strong
            ellipsis={{ tooltip: getEmployeeName(record) }}
            style={{ maxWidth: 220 }}
          >
            {getEmployeeName(record)}
          </Text>
          <Text
            type="secondary"
            ellipsis={{
              tooltip: record.employee_email || t("attendancePreview.noEmail"),
            }}
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
      title: t("attendancePreview.columns.duration"),
      key: "duration",
      width: 110,
      render: (_: unknown, record: AttendanceRecord) =>
        formatDurationBetween(record.check_in_at, record.check_out_at, "-"),
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 150,
      render: (value: AttendanceStatus) => (
        <Tag color={statusColors[value]}>{getStatusLabel(value)}</Tag>
      ),
    },
    {
      title: t("hr.attendance.source"),
      dataIndex: "source",
      key: "source",
      width: 140,
      render: (value: string) => (
        <Tag color={sourceColors[value] || "default"}>
          {getSourceLabel(value)}
        </Tag>
      ),
    },
    {
      title: t("bioTime.fields.empCode"),
      dataIndex: "biotime_emp_code",
      key: "biotime_emp_code",
      width: 120,
      render: (value: string | null) =>
        value ? <Text code>{value}</Text> : "-",
    },
    {
      title: t("bioTime.fields.terminalSn"),
      dataIndex: "biotime_terminal_sn",
      key: "biotime_terminal_sn",
      width: 150,
      render: (value: string | null) =>
        value ? (
          <Text
            type="secondary"
            ellipsis={{ tooltip: value }}
            style={{ fontSize: 12, maxWidth: 130 }}
          >
            {value}
          </Text>
        ) : (
          "-"
        ),
    },
    {
      title: t("attendancePreview.columns.override"),
      key: "is_overridden",
      width: 130,
      render: (_: unknown, record: AttendanceRecord) =>
        record.is_overridden ? (
          <Tooltip title={record.override_reason || undefined}>
            <Tag color="orange">{t("attendancePreview.overridden")}</Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">{t("attendancePreview.notOverridden")}</Text>
        ),
    },
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
                <Text type="secondary">
                  {t("attendancePreview.decision.noActionNeeded")}
                </Text>
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
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchRecords}
            loading={loading}
          >
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
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: item.color,
                    lineHeight: 1,
                  }}
                >
                  {item.value}
                </div>
              </div>
              {idx < summaryItems.length - 1 && (
                <Divider
                  type="vertical"
                  style={{ height: "auto", margin: 0 }}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </Card>

      <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div
          className="responsive-filter-bar"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
          }}
        >
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
            onChange={(value) =>
              handleRangeChange(
                value && value[0] && value[1] ? [value[0], value[1]] : null,
              )
            }
            presets={rangePresets}
            placeholder={[t("leave.startDate"), t("leave.endDate")]}
          />
          {supportsAdvancedFilters && (
            <>
              <Select
                showSearch
                allowClear
                filterOption={false}
                loading={loadingEmployees}
                notFoundContent={
                  loadingEmployees ? <Spin size="small" /> : undefined
                }
                placeholder={t("attendancePreview.filters.employeePlaceholder")}
                aria-label={t("attendancePreview.filters.employeePlaceholder")}
                style={{ flex: "0 1 260px", minWidth: 200 }}
                value={employeeId}
                onSearch={setEmployeeQueryInput}
                onChange={(value) => handleEmployeeChange(value ?? undefined)}
                options={employeeOptions}
              />
              <Select
                allowClear
                placeholder={t("attendancePreview.filters.sourcePlaceholder")}
                aria-label={t("attendancePreview.filters.sourcePlaceholder")}
                style={{ flex: "0 1 200px", minWidth: 160 }}
                value={source === "ALL" ? undefined : source}
                onChange={(value) =>
                  handleSourceChange((value as AttendanceSource) ?? "ALL")
                }
                options={SOURCE_OPTIONS.map((value) => ({
                  value,
                  label: getSourceLabel(value),
                }))}
              />
            </>
          )}
          <Button onClick={handleReset} disabled={!isFiltered}>
            {t("common.reset")}
          </Button>
        </div>

        <Divider style={{ margin: "14px 0" }} />

        <Space size={[8, 8]} wrap>
          <Tag.CheckableTag
            checked={status === "ALL"}
            onChange={() => handleStatusChange("ALL")}
          >
            {t("attendancePreview.filters.statusAll")}
          </Tag.CheckableTag>
          {STATUS_OPTIONS.map((value) => (
            <Tag.CheckableTag
              key={value}
              checked={status === value}
              onChange={() => handleStatusChange(value)}
            >
              {getStatusLabel(value)}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>

      {errorMessage ? (
        <ErrorState
          title={t("attendancePreview.error.title")}
          description={errorMessage}
          onRetry={fetchRecords}
        />
      ) : loading && records.length === 0 ? (
        <Card
          size="small"
          style={{
            borderRadius: 12,
            textAlign: "center",
            padding: "48px 24px",
          }}
        >
          <Spin tip={t("common.loading")}>
            <div style={{ minHeight: 24 }} />
          </Spin>
        </Card>
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
              onChange: (current, pageSize) =>
                setPagination({ current, pageSize }),
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
