import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Form,
  Input,
  Select,
  Spin,
  Typography,
} from "antd";
import dayjs from "dayjs";
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
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const employees = useEmployeeOptions();
  const latestRequest = useRef(0);

  useEffect(() => {
    setSearchInput(filters.search ?? "");
  }, [filters.search]);

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

  return (
    <Flex vertical gap={16}>
      <Typography.Text type="secondary">
        {t("attendancePolicy.notices.hrHint")}
      </Typography.Text>
      <Card size="small" style={{ borderRadius: 12 }}>
        <Form layout="vertical" component="div">
          <Flex wrap gap={12} align="flex-end">
            <Form.Item
              label={t("attendancePolicy.hr.search")}
              style={itemStyle("1 1 220px")}
              {...errorProps("search")}
            >
              <Input.Search
                allowClear
                value={searchInput}
                placeholder={t("attendancePolicy.hr.searchPlaceholder")}
                aria-label={t("attendancePolicy.hr.search")}
                onChange={(event) => setSearchInput(event.target.value)}
                onSearch={(value) =>
                  updateParams({ search: value.trim() || undefined })
                }
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
              label={t("common.employee")}
              style={itemStyle("1 1 220px")}
              {...errorProps("employee_profile_id")}
            >
              <Select
                showSearch
                allowClear
                filterOption={false}
                aria-label={t("common.employee")}
                placeholder={t("attendancePreview.filters.employeePlaceholder")}
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
          <Flex wrap gap={8} style={{ marginTop: 12 }}>
            <Button
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
      </Card>

      {problem ? (
        <NoticeProblemView problem={problem} />
      ) : (
        <Card size="small" style={{ borderRadius: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginBottom: 8 }}
          >
            {t("attendancePolicy.notices.resultCount", { count: total })}
          </Typography.Text>
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
        </Card>
      )}
    </Flex>
  );
}
