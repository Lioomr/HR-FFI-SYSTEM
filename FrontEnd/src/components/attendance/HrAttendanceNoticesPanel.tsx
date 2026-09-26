import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, DatePicker, Empty, Flex, Form, Select, Spin } from "antd";
import {
  AlertOutlined,
  BellOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  UndoOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import AttendanceQuickFilters from "./AttendanceQuickFilters";
import type { QuickFilterOption } from "./AttendanceQuickFilters";
import AttendanceNoticesTable, {
  NoticeProblemView,
} from "./AttendanceNoticesTable";
import { useEmployeeOptions } from "./useEmployeeOptions";
import { useI18n } from "../../i18n/useI18n";
import { getAttendanceNotices } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpStatus } from "../../services/api/httpErrors";
import {
  NOTICE_LEVELS,
  type AttendanceLateNotice,
} from "../../types/attendancePolicy";
import {
  NOTICE_FILTER_PARAMS,
  NOTICE_PAGE_SIZE,
  fieldErrorsFromResponse,
  noticeLevelLabel,
  noticeListProblem,
  readNoticeFilters,
  type NoticeListProblem,
} from "../../utils/attendancePolicy";

const { RangePicker } = DatePicker;

const itemStyle = (flex: string): CSSProperties => ({
  marginBottom: 0,
  flex,
  minWidth: 180,
});

/** Severity presets, matching the level tag colours in the table. */
const LEVEL_PRESETS: Record<
  number,
  { icon: QuickFilterOption["icon"]; tone: QuickFilterOption["tone"] }
> = {
  1: { icon: <InfoCircleOutlined />, tone: "informational" },
  2: { icon: <ExclamationCircleOutlined />, tone: "warning" },
  3: { icon: <WarningOutlined />, tone: "severe" },
  4: { icon: <AlertOutlined />, tone: "critical" },
};

function toDay(value?: string) {
  if (!value) return null;
  const parsed = dayjs(value, "YYYY-MM-DD");
  return parsed.isValid() ? parsed : null;
}

/**
 * Late-attendance notice history for HR in the active company. The company
 * comes from apiClient; every filter lives in the URL and is applied by the
 * server. Notices are issued automatically, so there is nothing to send here.
 */
export default function HrAttendanceNoticesPanel() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => readNoticeFilters(searchParams),
    [searchParams],
  );
  const filterKey = NOTICE_FILTER_PARAMS.map(
    (key) => `${key}=${searchParams.get(key) ?? ""}`,
  ).join("&");

  const [items, setItems] = useState<AttendanceLateNotice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<NoticeListProblem | null>(null);
  const employees = useEmployeeOptions({ withCode: false });
  const latestRequest = useRef(0);

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
    const request = ++latestRequest.current;
    const isCurrent = () => request === latestRequest.current;
    setLoading(true);
    try {
      const response = await getAttendanceNotices(filters);
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      setItems([]);
      setTotal(0);
      if (getHttpStatus(error) === 422) {
        const errors = fieldErrorsFromResponse(error);
        setFieldErrors(errors);
        setProblem(
          Object.keys(errors).length ? null : noticeListProblem(error),
        );
      } else {
        setFieldErrors({});
        setProblem(noticeListProblem(error));
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
    // `filterKey` changes exactly when a filter changes; `filters` follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const levels = [...(filters.notice_level ?? [])];
  const hasFilters = NOTICE_FILTER_PARAMS.some(
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

  const onlyLevel = levels.length === 1 ? levels[0] : undefined;
  const quickFilters: QuickFilterOption[] = [
    {
      key: "all",
      label: t("common.all"),
      icon: <UnorderedListOutlined />,
      tone: "neutral",
      active: levels.length === 0,
      onSelect: () => updateParams({ notice_level: undefined }),
    },
    ...NOTICE_LEVELS.map((level) => {
      const value = String(level);
      return {
        key: value,
        label: noticeLevelLabel(t, level),
        icon: LEVEL_PRESETS[level]?.icon ?? <BellOutlined />,
        tone: LEVEL_PRESETS[level]?.tone ?? "neutral",
        active: onlyLevel === value,
        onSelect: () =>
          updateParams({
            notice_level: onlyLevel === value ? undefined : value,
          }),
      };
    }),
  ];

  return (
    <div className="attendance-panel">
      <div className="attendance-panel__hint">
        <BellOutlined aria-hidden="true" />
        <span>{t("attendancePolicy.notices.hrHint")}</span>
      </div>

      <AttendanceQuickFilters
        label={t("attendancePolicy.notices.filterLevel")}
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
                label={t("attendancePolicy.notices.filterLevel")}
                style={itemStyle("1 1 200px")}
                {...errorProps("notice_level")}
              >
                <Select
                  mode="multiple"
                  allowClear
                  aria-label={t("attendancePolicy.notices.filterLevel")}
                  value={levels}
                  onChange={(value: string[]) =>
                    updateParams({ notice_level: value.join(",") || undefined })
                  }
                  options={NOTICE_LEVELS.map((level) => ({
                    value: String(level),
                    label: noticeLevelLabel(t, level),
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
                      NOTICE_FILTER_PARAMS.map((key) => [key, undefined]),
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
            <span>{t("attendancePolicy.hr.tabNotices")}</span>
            {!problem && (
              <span className="attendance-workspace__count">
                {t("attendancePolicy.notices.resultCount", { count: total })}
              </span>
            )}
          </div>
          {problem ? (
            <div className="attendance-workspace__alert">
              <NoticeProblemView problem={problem} />
            </div>
          ) : (
            <div className="attendance-results-table">
              <AttendanceNoticesTable
                showEmployee
                items={items}
                loading={loading}
                page={filters.page ?? 1}
                pageSize={filters.page_size ?? NOTICE_PAGE_SIZE}
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
                        : t("attendancePolicy.notices.empty")
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
