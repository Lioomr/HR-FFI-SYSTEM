import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Flex,
  Form,
  Select,
  Spin,
} from "antd";
import {
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import AttendanceQuickFilters from "./AttendanceQuickFilters";
import type { QuickFilterOption } from "./AttendanceQuickFilters";
import AttendanceViolationsTable from "./AttendanceViolationsTable";
import { useEmployeeOptions } from "./useEmployeeOptions";
import { useI18n } from "../../i18n/useI18n";
import { getAttendanceViolations } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  getHttpStatus,
} from "../../services/api/httpErrors";
import {
  ATTENDANCE_DEDUCTION_STATUSES,
  VIOLATION_LIFECYCLES,
  type AttendanceLateViolation,
} from "../../types/attendancePolicy";
import {
  VIOLATION_FILTER_PARAMS,
  fieldErrorsFromResponse,
  lifecycleLabel,
  payrollStatusLabel,
  readViolationFilters,
} from "../../utils/attendancePolicy";

const { RangePicker } = DatePicker;

const NEEDS_REVIEW = "manual_review";

/** Lifecycle presets, in the order HR works through them. */
const LIFECYCLE_PRESETS: Array<{
  value: string;
  icon: QuickFilterOption["icon"];
  tone: QuickFilterOption["tone"];
}> = [
  { value: NEEDS_REVIEW, icon: <AuditOutlined />, tone: "pending" },
  { value: "active", icon: <ClockCircleOutlined />, tone: "warning" },
  { value: "applied", icon: <CheckCircleOutlined />, tone: "critical" },
  { value: "void", icon: <StopOutlined />, tone: "neutral" },
];

const itemStyle = (flex: string): CSSProperties => ({
  marginBottom: 0,
  flex,
  minWidth: 180,
});

type Problem = { kind: "company" } | { kind: "error"; message: string };

function toDay(value?: string) {
  if (!value) return null;
  const parsed = dayjs(value, "YYYY-MM-DD");
  return parsed.isValid() ? parsed : null;
}

/**
 * Company late-violation history for HR. Every filter lives in the URL and is
 * applied by the server; invalid values come back as 422s on the controls.
 */
export default function HrAttendanceViolationsPanel() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => readViolationFilters(searchParams),
    [searchParams],
  );
  const filterKey = VIOLATION_FILTER_PARAMS.map(
    (key) => `${key}=${searchParams.get(key) ?? ""}`,
  ).join("&");

  const [items, setItems] = useState<AttendanceLateViolation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const employees = useEmployeeOptions({ withCode: false });

  const updateParams = useCallback(
    (patch: Record<string, string | undefined>, resetPage = true) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(patch).forEach(([key, value]) => {
            if (value === undefined || value === "") next.delete(key);
            else next.set(key, value);
          });
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAttendanceViolations(filters);
      if (isApiError(response)) {
        setItems([]);
        setTotal(0);
        setProblem({ kind: "error", message: response.message });
        return;
      }
      setItems(response.data.items ?? []);
      setTotal(response.data.count ?? 0);
      setFieldErrors({});
      setProblem(null);
    } catch (error) {
      setItems([]);
      setTotal(0);
      const status = getHttpStatus(error);
      if (status === 422) {
        const errors = fieldErrorsFromResponse(error);
        setFieldErrors(errors);
        setProblem(
          Object.keys(errors).length
            ? null
            : { kind: "error", message: getHttpErrorMessage(error) },
        );
      } else if (status === 403) {
        setFieldErrors({});
        setProblem({ kind: "company" });
      } else if (status === 404) {
        setFieldErrors({});
        setProblem(null);
      } else {
        setFieldErrors({});
        setProblem({ kind: "error", message: getHttpErrorMessage(error) });
      }
    } finally {
      setLoading(false);
    }
    // `filterKey` changes exactly when a filter changes; `filters` follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const lifecycle = [...(filters.lifecycle ?? [])];
  const payrollStatus = [...(filters.payroll_status ?? [])];
  const onlyLifecycle = lifecycle.length === 1 ? lifecycle[0] : undefined;
  const hasFilters = VIOLATION_FILTER_PARAMS.some(
    (key) => key !== "page" && key !== "page_size" && searchParams.has(key),
  );

  const employeeValue =
    filters.employee_profile_id === undefined
      ? undefined
      : /^\d+$/.test(String(filters.employee_profile_id))
        ? Number(filters.employee_profile_id)
        : String(filters.employee_profile_id);
  const employeeOptions =
    employeeValue !== undefined &&
    !employees.options.some((option) => option.value === employeeValue)
      ? [
          ...employees.options,
          { value: employeeValue, label: `#${employeeValue}` },
        ]
      : employees.options;

  const errorProps = (...fields: string[]) => {
    const message = fields.map((field) => fieldErrors[field]).find(Boolean);
    return message
      ? { validateStatus: "error" as const, help: message }
      : { validateStatus: undefined, help: undefined };
  };

  const rangeValue: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null =
    filters.date_from || filters.date_to
      ? [toDay(filters.date_from), toDay(filters.date_to)]
      : null;

  const quickFilters: QuickFilterOption[] = [
    {
      key: "all",
      label: t("common.all"),
      icon: <UnorderedListOutlined />,
      tone: "neutral",
      active: lifecycle.length === 0,
      onSelect: () => updateParams({ lifecycle: undefined }),
    },
    ...LIFECYCLE_PRESETS.map(({ value, icon, tone }) => ({
      key: value,
      label:
        value === NEEDS_REVIEW
          ? t("attendancePolicy.hr.needsReview")
          : lifecycleLabel(t, value),
      icon,
      tone,
      active: onlyLifecycle === value,
      onSelect: () =>
        updateParams({
          lifecycle: onlyLifecycle === value ? undefined : value,
        }),
    })),
  ];

  return (
    <div className="attendance-panel">
      <AttendanceQuickFilters
        label={t("attendancePolicy.violation.lifecycle")}
        options={quickFilters}
      />

      <section className="attendance-workspace">
        <div className="attendance-workspace__toolbar">
          <Form
            layout="vertical"
            component="div"
            className="attendance-panel__form"
          >
            <Flex wrap gap={12} align="flex-end">
              <Form.Item
                label={t("common.employee")}
                style={itemStyle("1 1 220px")}
                {...errorProps("employee_profile_id")}
              >
                <Select
                  showSearch
                  allowClear
                  filterOption={false}
                  aria-label={t("common.employee")}
                  placeholder={t(
                    "attendancePreview.filters.employeePlaceholder",
                  )}
                  loading={employees.loading}
                  notFoundContent={
                    employees.loading ? <Spin size="small" /> : undefined
                  }
                  value={employeeValue}
                  onSearch={employees.onSearch}
                  onChange={(value?: number | string) =>
                    updateParams({
                      employee_profile_id:
                        value === undefined || value === null
                          ? undefined
                          : String(value),
                    })
                  }
                  options={employeeOptions}
                />
              </Form.Item>
              <Form.Item
                label={t("attendancePolicy.violation.lifecycle")}
                style={itemStyle("1 1 200px")}
                {...errorProps("lifecycle")}
              >
                <Select
                  mode="multiple"
                  allowClear
                  aria-label={t("attendancePolicy.violation.lifecycle")}
                  value={lifecycle}
                  onChange={(value: string[]) =>
                    updateParams({ lifecycle: value.join(",") || undefined })
                  }
                  options={VIOLATION_LIFECYCLES.map((value) => ({
                    value,
                    label: lifecycleLabel(t, value),
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={t("attendancePolicy.violation.payrollStatus")}
                style={itemStyle("1 1 200px")}
                {...errorProps("payroll_status")}
              >
                <Select
                  mode="multiple"
                  allowClear
                  aria-label={t("attendancePolicy.violation.payrollStatus")}
                  value={payrollStatus}
                  onChange={(value: string[]) =>
                    updateParams({
                      payroll_status: value.join(",") || undefined,
                    })
                  }
                  options={ATTENDANCE_DEDUCTION_STATUSES.map((value) => ({
                    value,
                    label: payrollStatusLabel(t, value),
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={t("attendancePolicy.hr.dateRange")}
                style={itemStyle("1 1 260px")}
                {...errorProps("date_from", "date_to")}
              >
                <RangePicker
                  allowEmpty={[true, true]}
                  style={{ width: "100%" }}
                  value={rangeValue}
                  onChange={(value) =>
                    updateParams({
                      date_from: value?.[0]?.format("YYYY-MM-DD"),
                      date_to: value?.[1]?.format("YYYY-MM-DD"),
                    })
                  }
                />
              </Form.Item>
            </Flex>
            <Flex wrap gap={8} className="attendance-panel__actions">
              <Button
                type="text"
                icon={<UndoOutlined aria-hidden="true" />}
                className="attendance-filters__reset"
                disabled={!hasFilters}
                onClick={() =>
                  updateParams(
                    Object.fromEntries(
                      VIOLATION_FILTER_PARAMS.map((key) => [key, undefined]),
                    ),
                  )
                }
              >
                {t("attendancePolicy.hr.clearFilters")}
              </Button>
            </Flex>
          </Form>
        </div>

        <div className="attendance-workspace__results">
          <div className="attendance-workspace__results-heading">
            <span>{t("attendancePolicy.hr.tabViolations")}</span>
            {!problem && (
              <span className="attendance-workspace__count">
                {t("attendancePolicy.hr.resultCount", { count: total })}
              </span>
            )}
          </div>
          {problem?.kind === "company" ? (
            <Alert
              className="attendance-workspace__alert"
              type="warning"
              showIcon
              title={t("attendancePolicy.history.companyRequired")}
              description={t("attendancePolicy.companyRequiredHint")}
            />
          ) : problem?.kind === "error" ? (
            <Alert
              className="attendance-workspace__alert"
              type="error"
              showIcon
              title={t("attendancePolicy.history.loadFailed")}
              description={problem.message}
            />
          ) : (
            <div className="attendance-results-table">
              <AttendanceViolationsTable
                showEmployee
                items={items}
                loading={loading}
                page={filters.page ?? 1}
                pageSize={filters.page_size ?? 25}
                total={total}
                onPageChange={(page, pageSize) =>
                  updateParams(
                    { page: String(page), page_size: String(pageSize) },
                    false,
                  )
                }
                emptyText={
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      Object.keys(fieldErrors).length
                        ? t("attendancePolicy.hr.fixFilters")
                        : t("attendancePolicy.history.empty")
                    }
                  />
                }
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
