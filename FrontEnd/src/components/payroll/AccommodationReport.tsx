import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Collapse, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useI18n } from "../../i18n/useI18n";
import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import MoneyText, { ExactShareText } from "./MoneyText";
import { useCanManagePayrollHrData } from "./payrollFormat";
import { getAccommodationReport } from "../../services/api/accommodationApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../services/api/payrollErrors";
import type {
  AccommodationReportProperty,
  PayrollRunItemDto,
  RentResidentShare,
} from "../../services/api/payrollTypes";

const { Text } = Typography;
export default function AccommodationReport({
  runId,
  refreshKey,
  index = null,
  onQuickNone,
}: {
  runId: number | string;
  refreshKey: number;
  index?: PayrollRunItemDto[] | null;
  onQuickNone?: (employee: {
    employee_profile_id: number;
    employee_name: string;
    item_id: number | null;
  }) => ReactNode;
}) {
  const { t } = useI18n();
  const profiles = useCanManagePayrollHrData();
  const [properties, setProperties] = useState<AccommodationReportProperty[]>(
    [],
  );
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getAccommodationReport(runId, { page, page_size: 10 });
      if (current !== generation.current) return;
      setProperties(data.items);
      setCount(data.count);
    } catch (err) {
      if (current !== generation.current) return;
      setError(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.reportLoadFailed"),
        ),
      );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [runId, page, t]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  const residents: ColumnsType<RentResidentShare> = [
    {
      title: t("payroll.ui.employee"),
      key: "employee",
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          {profiles ? (
            <Link to={`/hr/employees/${row.employee.employee_profile_id}`}>
              {row.employee.employee_name}
            </Link>
          ) : (
            <Text>{row.employee.employee_name}</Text>
          )}
          <Text type="secondary">
            <bdi dir="ltr">{row.employee.employee_id}</bdi>
          </Text>
        </Space>
      ),
    },
    {
      title: t("payroll.ui.inPayroll"),
      key: "payroll",
      render: (_, row) => (
        <Text type={row.in_payroll ? undefined : "secondary"}>
          {row.in_payroll
            ? t("payroll.ui.yes")
            : row.payroll_status_label?.message ||
              t("payroll.rent.not_in_payroll")}
        </Text>
      ),
    },
    {
      title: t("payroll.ui.roundedShare"),
      key: "share",
      align: "end",
      render: (_, row) => (
        <Tooltip
          title={
            <>
              {t("payroll.ui.approximateNote")}{" "}
              <ExactShareText share={row.raw_share} />
            </>
          }
        >
          <span
            tabIndex={0}
            role="button"
            aria-label={t("payroll.ui.rawShare")}
          >
            <MoneyText amount={row.rounded_share} />
          </span>
        </Tooltip>
      ),
    },
  ];
  const columns: ColumnsType<AccommodationReportProperty> = [
    {
      title: t("payroll.ui.property"),
      dataIndex: "rent_name",
      key: "property",
      render: (name, row) => (
        <Space orientation="vertical" size={0}>
          <Text type={row.residents.length ? undefined : "secondary"}>
            {name}
          </Text>
          {!row.residents.length && (
            <Text type="secondary">{t("payroll.ux3.noResidents")}</Text>
          )}
        </Space>
      ),
    },
    {
      title: t("payroll.ui.periodRent"),
      key: "period",
      align: "end",
      render: (_, row) => (
        <ExactShareText share={row.period_rent ?? row.monthly_rent} />
      ),
    },
    {
      title: t("payroll.ui.monthlyRentReference"),
      key: "monthly",
      align: "end",
      render: (_, row) => <ExactShareText share={row.monthly_rent} />,
    },
    {
      title: t("payroll.ui.inPayrollRounded"),
      key: "allocated",
      align: "end",
      render: (_, row) => <MoneyText amount={row.in_payroll_rounded} />,
    },
    {
      title: t("payroll.rent.vacant_unallocated"),
      key: "vacancy",
      align: "end",
      render: (_, row) => <ExactShareText share={row.vacant_unallocated_raw} />,
    },
    {
      title: t("payroll.rent.rounding_difference"),
      key: "rounding",
      align: "end",
      render: (_, row) => (
        <Tooltip title={row.rounding_difference_label?.message}>
          <span>
            <ExactShareText share={row.rounding_difference} />
          </span>
        </Tooltip>
      ),
    },
    {
      title: t("payroll.ui.validation"),
      key: "reconciliation",
      render: (_, row) => (
        <Tag>
          {t(
            row.raw_reconciliation.matches
              ? "payroll.ui.rawReconciled"
              : "payroll.ui.rawNotReconciled",
          )}
        </Tag>
      ),
    },
  ];
  const unknown =
    index?.filter((item) => item.accommodation_status === "unknown") ?? [];
  if (error)
    return (
      <ErrorState
        title={t("payroll.ui.reportLoadFailed")}
        description={error}
        onRetry={() => void load()}
      />
    );
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <div className="payroll-finance-toolbar">
        <Text type="secondary">{t("payroll.ui.approximateNote")}</Text>
        <Link to="/hr/payroll/accommodation">
          {t("payroll.ui.assignmentsTitle")}
        </Link>
      </div>
      {!loading && !properties.length ? (
        <EmptyState
          title={t("payroll.ui.reportEmptyTitle")}
          description={t("payroll.ui.reportEmpty")}
        />
      ) : (
        <Table
          size="small"
          rowKey="rent_id"
          loading={loading}
          columns={columns}
          dataSource={properties}
          scroll={{ x: 980 }}
          pagination={
            count > 10
              ? {
                  current: page,
                  pageSize: 10,
                  total: count,
                  showSizeChanger: false,
                  onChange: setPage,
                }
              : false
          }
          expandable={{
            rowExpandable: (row) => row.residents.length > 0,
            expandedRowRender: (property) => (
              <>
                <Table
                  size="small"
                  rowKey={(row) => row.employee.employee_profile_id}
                  columns={residents}
                  dataSource={property.residents}
                  pagination={false}
                />
                <Collapse
                  items={[
                    {
                      key: "slots",
                      label: t("payroll.ui.slotsTitle", {
                        count: property.slots.length,
                      }),
                      children: (
                        <Table
                          size="small"
                          rowKey="slot"
                          dataSource={property.slots}
                          pagination={false}
                          columns={[
                            {
                              title: t("payroll.ui.date"),
                              key: "date",
                              render: (_, slot) => (
                                <bdi dir="ltr">{slot.calendar_date}</bdi>
                              ),
                            },
                            {
                              title: t("payroll.ui.residents"),
                              key: "residents",
                              render: (_, slot) =>
                                slot.resident_profile_ids.length,
                            },
                            {
                              title: t("payroll.ui.dailyShare"),
                              key: "share",
                              render: (_, slot) =>
                                slot.raw_daily_share ? (
                                  <ExactShareText
                                    share={slot.raw_daily_share}
                                  />
                                ) : (
                                  t("payroll.rent.vacant_unallocated")
                                ),
                            },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </>
            ),
          }}
        />
      )}
      {!index ? (
        <Text type="secondary">{t("payroll.ux.indexUnavailable")}</Text>
      ) : (
        unknown.length > 0 && (
          <Collapse
            items={[
              {
                key: "unknown",
                label: t("payroll.ux3.accommodationUnknown", {
                  count: unknown.length,
                }),
                children: (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={unknown}
                    columns={[
                      {
                        title: t("payroll.ui.employee"),
                        key: "employee",
                        render: (_, item) =>
                          profiles ? (
                            <Link
                              to={`/hr/employees/${item.employee_profile_id}`}
                            >
                              {item.employee_name}
                            </Link>
                          ) : (
                            item.employee_name
                          ),
                      },
                      {
                        title: t("payroll.ui.accommodationStatus"),
                        key: "status",
                        render: () => t("payroll.ui.unknown"),
                      },
                      {
                        title: t("payroll.ui.actions"),
                        key: "action",
                        render: (_, item) => (
                          <Space>
                            <Link
                              to={`/hr/payroll/accommodation?employee_profile_id=${item.employee_profile_id}`}
                            >
                              {t("payroll.employee.fix")}
                            </Link>
                            {onQuickNone?.({ ...item, item_id: item.id })}
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        )
      )}
    </Space>
  );
}
