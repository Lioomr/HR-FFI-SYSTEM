import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  DatePicker,
  Input,
  Select,
  Space,
  Spin,
  Tabs,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BellOutlined,
  CalculatorOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  FileDoneOutlined,
  HourglassOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  TableOutlined,
  UndoOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import HrAttendanceNoticesPanel from "../../components/attendance/HrAttendanceNoticesPanel";
import HrAttendanceViolationsPanel from "../../components/attendance/HrAttendanceViolationsPanel";
import RecalculateAttendanceModal from "../../components/attendance/RecalculateAttendanceModal";

import PageHeader from "../../components/ui/PageHeader";
import ResponsiveTable from "../../components/ui/ResponsiveTable";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import {
  getCEOAttendance,
  getGlobalAttendance,
} from "../../services/api/attendanceApi";
import type { AttendanceListResponse } from "../../services/api/attendanceApi";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import type {
  AttendanceFilters,
  AttendanceRecord,
  AttendanceSource,
  EffectiveAttendanceStatus,
} from "../../types/attendance";
import { unwrapEnvelope, normalizeListData } from "../../utils/dataUtils";
import {
  formatDateOnly,
  formatDurationBetween,
  formatTimeOnly,
} from "../../utils/dateTime";
import { downloadBlob } from "../../utils/download";
import { useI18n } from "../../i18n/useI18n";
import "./AttendancePreviewPage.css";

const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 10000;

/** Quote a CSV field only when it contains a delimiter, quote, or newline. */
const csvCell = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const { RangePicker } = DatePicker;
const { Text } = Typography;

type PreviewRole = "hr" | "ceo";

interface AttendancePreviewPageProps {
  role: PreviewRole;
}

const SOURCE_OPTIONS: AttendanceSource[] = ["SYSTEM", "EMPLOYEE", "HR"];

const statusTone: Record<EffectiveAttendanceStatus, string> = {
  PRESENT: "positive",
  ABSENT: "critical",
  EXCUSED: "informational",
  LATE: "warning",
  PENDING: "pending",
  PENDING_HR: "pending",
  PENDING_MGR: "pending",
  PENDING_CEO: "pending",
  REJECTED: "critical",
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
  // HR also gets the late-violation and notice histories and recalculation; the
  // tab lives in the URL so a filtered view can be shared or reloaded.
  const isHr = role === "hr";
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab =
    isHr && (tabParam === "violations" || tabParam === "notices")
      ? tabParam
      : "records";
  const [recalcOpen, setRecalcOpen] = useState(false);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<
    Partial<Record<EffectiveAttendanceStatus, number>>
  >({});
  const [overviewTotal, setOverviewTotal] = useState(0);
  const [overviewError, setOverviewError] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewRefresh, setOverviewRefresh] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [status, setStatus] = useState<EffectiveAttendanceStatus | "ALL">(
    "ALL",
  );
  const [source, setSource] = useState<AttendanceSource | "ALL">("ALL");
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(
    defaultRange(),
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState<number | undefined>(undefined);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

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

  // Filter params shared by the paged table fetch and the CSV export, minus
  // pagination — the export walks its own pages.
  const buildScopeParams = useCallback((): AttendanceFilters => {
    const params: AttendanceFilters = {};
    if (dateRange) {
      params.date_from = dateRange[0].format("YYYY-MM-DD");
      params.date_to = dateRange[1].format("YYYY-MM-DD");
    }
    if (search) params.search = search;
    if (supportsAdvancedFilters) {
      if (source !== "ALL") params.source = source;
      if (employeeId) params.employee_id = employeeId;
    }
    return params;
  }, [dateRange, employeeId, search, source, supportsAdvancedFilters]);

  const buildBaseParams = useCallback((): AttendanceFilters => {
    const params = buildScopeParams();
    if (status !== "ALL") params.effective_status = status;
    return params;
  }, [buildScopeParams, status]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params: AttendanceFilters = {
        ...buildBaseParams(),
        page: pagination.current,
        page_size: pagination.pageSize,
      };

      const response =
        role === "ceo"
          ? await getCEOAttendance(params)
          : await getGlobalAttendance(params);
      const data = unwrapEnvelope(response) as AttendanceListResponse & {
        summary?: Partial<Record<EffectiveAttendanceStatus, number>>;
      };
      const normalized = normalizeListData<AttendanceRecord>(data);
      setRecords(normalized.items);
      setTotal(normalized.total);
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
  }, [buildBaseParams, pagination, role]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    let active = true;
    const loadOverview = async () => {
      setOverviewLoading(true);
      try {
        const params: AttendanceFilters = {
          ...buildScopeParams(),
          page: 1,
          page_size: 1,
        };
        const response =
          role === "ceo"
            ? await getCEOAttendance(params)
            : await getGlobalAttendance(params);
        const data = unwrapEnvelope(response) as AttendanceListResponse;
        if (!active) return;
        setOverviewTotal(normalizeListData<AttendanceRecord>(data).total);
        setSummary(data.effective_summary || data.summary || {});
        setOverviewError(false);
      } catch {
        if (!active) return;
        setOverviewError(true);
      } finally {
        if (active) setOverviewLoading(false);
      }
    };
    void loadOverview();
    return () => {
      active = false;
    };
  }, [buildScopeParams, overviewRefresh, role]);

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

  const handleStatusChange = (value: EffectiveAttendanceStatus | "ALL") => {
    setStatus((current) => (current === value ? "ALL" : value));
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

  const getStatusLabel = (
    value: EffectiveAttendanceStatus,
    rawStatus?: EffectiveAttendanceStatus,
  ) => {
    if (value === "EXCUSED" && rawStatus === "LATE") {
      return t("attendancePreview.status.lateExcused");
    }
    const keyByStatus: Record<EffectiveAttendanceStatus, string> = {
      PRESENT: "attendancePreview.status.present",
      ABSENT: "attendancePreview.status.absent",
      EXCUSED: "attendancePreview.status.excused",
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

  const getEmployeeShortName = (record: AttendanceRecord) =>
    getEmployeeName(record).trim().split(/\s+/).slice(0, 2).join(" ");

  const handleExport = async () => {
    setExporting(true);
    try {
      const base = buildBaseParams();
      const rows: AttendanceRecord[] = [];
      let page = 1;
      let expected = Infinity;

      while (rows.length < expected && rows.length < EXPORT_MAX_ROWS) {
        const pageParams: AttendanceFilters = {
          ...base,
          page,
          page_size: EXPORT_PAGE_SIZE,
        };
        const response =
          role === "ceo"
            ? await getCEOAttendance(pageParams)
            : await getGlobalAttendance(pageParams);
        const data = unwrapEnvelope(response);
        const normalized = normalizeListData<AttendanceRecord>(data);
        rows.push(...normalized.items);
        expected = normalized.total || rows.length;
        if (normalized.items.length === 0) break;
        page += 1;
      }

      if (rows.length === 0) {
        message.info(t("attendancePreview.export.empty"));
        return;
      }

      const header = [
        t("common.employee"),
        t("common.date"),
        t("attendance.checkIn"),
        t("attendance.checkOut"),
        t("attendancePreview.columns.duration"),
        t("common.status"),
        t("attendancePreview.approvedLeaveReference"),
        t("attendancePreview.columns.lateBy"),
        t("hr.attendance.source"),
      ];
      const body = rows.map((record) => [
        getEmployeeName(record),
        formatDateOnly(record.date),
        formatTimeOnly(record.check_in_at, ""),
        formatTimeOnly(record.check_out_at, ""),
        formatDurationBetween(record.check_in_at, record.check_out_at, ""),
        getStatusLabel(record.effective_status || record.status, record.status),
        record.excused_by_leave_id || "",
        record.late_minutes && record.late_minutes > 0
          ? String(record.late_minutes)
          : "",
        getSourceLabel(record.source),
      ]);
      const csv = [header, ...body]
        .map((cols) => cols.map(csvCell).join(","))
        .join("\r\n");

      // Prepend a UTF-8 BOM so Excel reads non-ASCII (e.g. Arabic names) right.
      const bom = String.fromCharCode(0xfeff);
      downloadBlob(
        new Blob([bom + csv], { type: "text/csv;charset=utf-8;" }),
        `attendance-${dayjs().format("YYYY-MM-DD")}.csv`,
      );

      if (rows.length >= EXPORT_MAX_ROWS && expected > EXPORT_MAX_ROWS) {
        message.warning(
          t("attendancePreview.export.capped", { max: EXPORT_MAX_ROWS }),
        );
      }
    } catch (error: any) {
      message.error(error?.message || t("attendancePreview.export.failed"));
    } finally {
      setExporting(false);
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
          label: name,
        };
      }),
    [employeeOptionsSource, language],
  );

  const pendingTotal =
    (summary.PENDING || 0) +
    (summary.PENDING_HR || 0) +
    (summary.PENDING_MGR || 0) +
    (summary.PENDING_CEO || 0);

  // Attendance rate = present-or-late as a share of every accountable record
  // (i.e. excluding pending and rejected). "—" when nothing is accountable yet.
  const onTimeOrLate = (summary.PRESENT || 0) + (summary.LATE || 0);
  const accountable = onTimeOrLate + (summary.ABSENT || 0);
  const attendanceRate =
    accountable > 0
      ? `${Math.round((onTimeOrLate / accountable) * 100)}%`
      : "—";

  const ratePercent =
    accountable > 0 ? Math.round((onTimeOrLate / accountable) * 100) : 0;

  const summaryItems: Array<{
    label: string;
    value: number;
    tone: string;
    icon: React.ReactNode;
    status: EffectiveAttendanceStatus | "ALL";
  }> = [
    {
      label: t("attendancePreview.summary.total"),
      value: overviewTotal,
      tone: "neutral",
      icon: <UnorderedListOutlined />,
      status: "ALL",
    },
    {
      label: t("attendancePreview.status.present"),
      value: summary.PRESENT || 0,
      tone: "positive",
      icon: <CheckCircleOutlined />,
      status: "PRESENT",
    },
    {
      label: t("attendancePreview.status.late"),
      value: summary.LATE || 0,
      tone: "warning",
      icon: <ClockCircleOutlined />,
      status: "LATE",
    },
    {
      label: t("attendancePreview.status.absent"),
      value: summary.ABSENT || 0,
      tone: "critical",
      icon: <CloseCircleOutlined />,
      status: "ABSENT",
    },
    {
      label: t("attendancePreview.status.excused"),
      value: summary.EXCUSED || 0,
      tone: "informational",
      icon: <FileDoneOutlined />,
      status: "EXCUSED",
    },
    {
      label: t("attendancePreview.status.pending"),
      value: pendingTotal,
      tone: "pending",
      icon: <HourglassOutlined />,
      status: "PENDING",
    },
    {
      label: t("attendancePreview.status.rejected"),
      value: summary.REJECTED || 0,
      tone: "critical",
      icon: <StopOutlined />,
      status: "REJECTED",
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
            <span title={getEmployeeName(record)}>
              {getEmployeeShortName(record)}
            </span>
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
      title: t("attendancePreview.columns.lateBy"),
      key: "late_minutes",
      width: 100,
      render: (_: unknown, record: AttendanceRecord) =>
        record.late_minutes && record.late_minutes > 0 ? (
          <span className="attendance-late">+{record.late_minutes}m</span>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 170,
      render: (value: EffectiveAttendanceStatus, record: AttendanceRecord) => (
        <Space size={4} wrap>
          <span
            className={`attendance-badge attendance-badge--${statusTone[record.effective_status || value]}`}
          >
            {getStatusLabel(record.effective_status || value, record.status)}
          </span>
          {record.excused_by_leave_id && (
            <Text type="secondary">
              {t("attendancePreview.approvedLeaveReference")} #
              {record.excused_by_leave_id}
            </Text>
          )}
          {record.is_late_flagged && value.startsWith("PENDING") && (
            <span className="attendance-badge attendance-badge--warning">
              {t("attendancePreview.lateArrivalTag")}
            </span>
          )}
        </Space>
      ),
    },
    {
      title: t("hr.attendance.source"),
      dataIndex: "source",
      key: "source",
      width: 140,
      render: (value: string) => (
        <span className="attendance-source">{getSourceLabel(value)}</span>
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
  ];

  const recordsActions = (
    <>
      <Button
        icon={<DownloadOutlined />}
        onClick={handleExport}
        loading={exporting}
        disabled={loading || records.length === 0}
      >
        {t("attendancePreview.export.button")}
      </Button>
      <Button
        icon={<ReloadOutlined />}
        onClick={() => {
          void fetchRecords();
          setOverviewRefresh((current) => current + 1);
        }}
        loading={loading}
      >
        {t("common.refresh")}
      </Button>
    </>
  );

  const recordsView = (
    <>
      <section
        className="attendance-overview"
        aria-label={t("attendancePreview.overview")}
        aria-busy={overviewLoading}
      >
        {overviewError && (
          <div className="attendance-overview__error" role="alert">
            {t("attendancePreview.loadFailed")}
          </div>
        )}
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
                {overviewLoading && accountable === 0 ? (
                  <span className="attendance-skeleton attendance-skeleton--lg" />
                ) : (
                  attendanceRate
                )}
              </div>
              <div className="attendance-rate__caption">
                {onTimeOrLate} / {accountable}
              </div>
            </div>
          </div>

          <div className="attendance-overview__grid">
            {summaryItems.map((item) => {
              const share =
                item.status === "ALL" || overviewTotal === 0
                  ? 100
                  : Math.round((item.value / overviewTotal) * 100);
              return (
                <button
                  type="button"
                  className={`attendance-metric attendance-metric--${item.tone}`}
                  key={item.label}
                  aria-pressed={status === item.status}
                  onClick={() => handleStatusChange(item.status)}
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
                  <span className="attendance-metric__value">
                    {overviewLoading && overviewTotal === 0 ? (
                      <span className="attendance-skeleton" />
                    ) : (
                      item.value
                    )}
                  </span>
                  <span className="attendance-metric__bar" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="attendance-workspace">
        <div className="attendance-workspace__toolbar">
          <div className="attendance-filters responsive-filter-bar">
            {/* HR picks one employee; the CEO endpoint only has free-text search. */}
            {supportsAdvancedFilters ? (
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
                className="attendance-filters__employee"
                value={employeeId}
                onSearch={setEmployeeQueryInput}
                onChange={(value) => handleEmployeeChange(value ?? undefined)}
                options={employeeOptions}
              />
            ) : (
              <Input
                allowClear
                prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
                placeholder={t("attendancePreview.filters.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="attendance-filters__search"
              />
            )}
            <RangePicker
              className="attendance-filters__range"
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
              <Select
                allowClear
                placeholder={t("attendancePreview.filters.sourcePlaceholder")}
                aria-label={t("attendancePreview.filters.sourcePlaceholder")}
                className="attendance-filters__source"
                value={source === "ALL" ? undefined : source}
                onChange={(value) =>
                  handleSourceChange((value as AttendanceSource) ?? "ALL")
                }
                options={SOURCE_OPTIONS.map((value) => ({
                  value,
                  label: getSourceLabel(value),
                }))}
              />
            )}
            <Button
              type="text"
              icon={<UndoOutlined aria-hidden="true" />}
              className="attendance-filters__reset"
              onClick={handleReset}
              disabled={!isFiltered}
            >
              {t("common.reset")}
            </Button>
          </div>
        </div>

        <div className="attendance-workspace__results">
          <div className="attendance-workspace__results-heading">
            <span>{t("attendancePolicy.hr.tabRecords")}</span>
            <span className="attendance-workspace__count">
              {loading && <Spin size="small" />}
              {t("attendancePreview.resultsCount", { count: total })}
            </span>
          </div>
          {errorMessage ? (
            <ErrorState
              title={t("attendancePreview.error.title")}
              description={errorMessage}
              onRetry={fetchRecords}
            />
          ) : loading && records.length === 0 ? (
            <div className="attendance-workspace__loading">
              <Spin tip={t("common.loading")}>
                <div style={{ minHeight: 24 }} />
              </Spin>
            </div>
          ) : !loading && records.length === 0 ? (
            <EmptyState
              title={t("attendancePreview.empty.title")}
              description={t("attendancePreview.empty.description")}
            />
          ) : (
            <div className="attendance-results-table">
              <ResponsiveTable
                mobileCard={{
                  titleKey: "employee",
                  extraKey: "status",
                }}
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
            </div>
          )}
        </div>
      </section>
    </>
  );

  return (
    <div className="attendance-page">
      <PageHeader
        title={
          role === "ceo"
            ? t("ceo.attendance.title")
            : t("hr.attendance.recordsTitle")
        }
        subtitle={t("attendance.biotimeNotice")}
        actions={
          <Space wrap>
            {isHr && (
              <Button
                icon={<CalculatorOutlined />}
                onClick={() => setRecalcOpen(true)}
              >
                {t("attendancePolicy.recalc.button")}
              </Button>
            )}
            {activeTab === "records" && recordsActions}
          </Space>
        }
      />

      {isHr ? (
        <Tabs
          className="ffi-pill-tabs"
          activeKey={activeTab}
          onChange={(key) =>
            setSearchParams(key === "records" ? {} : { tab: key }, {
              replace: true,
            })
          }
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
              children: <HrAttendanceViolationsPanel />,
            },
            {
              key: "notices",
              icon: <BellOutlined aria-hidden="true" />,
              label: t("attendancePolicy.hr.tabNotices"),
              children: <HrAttendanceNoticesPanel />,
            },
          ]}
        />
      ) : (
        recordsView
      )}

      {isHr && (
        <RecalculateAttendanceModal
          open={recalcOpen}
          onClose={() => setRecalcOpen(false)}
          onRecalculated={() => {
            if (activeTab === "records") {
              void fetchRecords();
              setOverviewRefresh((current) => current + 1);
            }
          }}
        />
      )}
    </div>
  );
};

export default AttendancePreviewPage;
