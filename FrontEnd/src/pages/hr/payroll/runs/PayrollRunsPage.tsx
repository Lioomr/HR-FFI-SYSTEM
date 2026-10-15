import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  HomeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import PageHeader from "../../../../components/ui/PageHeader";
import ResponsiveTable from "../../../../components/ui/ResponsiveTable";
import ErrorState from "../../../../components/ui/ErrorState";
import EmptyState from "../../../../components/ui/EmptyState";
import Unauthorized403Page from "../../../Unauthorized403Page";
import MoneyText from "../../../../components/payroll/MoneyText";
import PayrollTheme from "../../../../components/payroll/PayrollTheme";
import { readPayrollIndex } from "../../../../components/payroll/payrollIndex";
import { validationPresentation } from "../../../../components/payroll/validationGroups";
import { PayrollStatusTag } from "../../../../components/payroll/payrollDisplay";
import { formatPayrollPeriod } from "../../../../components/payroll/payrollFormat";
import { useI18n } from "../../../../i18n/useI18n";
import { formatDateTime } from "../../../../utils/dateTime";
import { isForbidden } from "../../../../services/api/httpErrors";
import {
  listPayrollRuns,
  getValidationReport,
} from "../../../../services/api/payrollApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../../services/api/payrollErrors";
import type {
  PayrollRunDto,
  PayrollStatus,
} from "../../../../services/api/payrollTypes";

const { Text } = Typography;
const STATUSES: PayrollStatus[] = ["DRAFT", "COMPLETED", "PAID", "CANCELLED"];

/** C: payroll run list with year/month/status filters (contract 7.2). */
export default function PayrollRunsPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<PayrollRunDto[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [year, setYear] = useState<number | undefined>();
  const [month, setMonth] = useState<number | undefined>();
  const [status, setStatus] = useState<PayrollStatus | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [actionable, setActionable] = useState<Record<number, number>>({});
  useEffect(() => {
    let active = true;
    let cursor = 0;
    setActionable({});
    const read = async () => {
      while (cursor < runs.length && active) {
        const run = runs[cursor++];
        try {
          const [report, index] = await Promise.all([
            getValidationReport(run.id),
            readPayrollIndex(run.id),
          ]);
          if (
            active &&
            !index.limited &&
            report.revision === run.revision &&
            index.items.every((item) => item.run_revision === run.revision)
          ) {
            const view = validationPresentation(report, index.items);
            setActionable((current) => ({
              ...current,
              [run.id]: view.warnings,
            }));
          }
        } catch {
          /* A missing complete index stays unavailable. */
        }
      }
    };
    void Promise.all([read(), read()]);
    return () => {
      active = false;
    };
  }, [runs, t]);

  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listPayrollRuns({
        page,
        page_size: pageSize,
        year,
        month,
        status,
      });
      if (current !== generation.current) return;
      setRuns(data.items);
      setCount(data.count);
    } catch (err) {
      if (current !== generation.current) return;
      if (isForbidden(err)) setForbidden(true);
      else
        setError(
          payrollErrorSummary(
            parsePayrollError(err),
            t("payroll.ui.runsLoadFailed"),
          ),
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [page, pageSize, year, month, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <Unauthorized403Page />;

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  const columns: ColumnsType<PayrollRunDto> = [
    {
      title: t("payroll.ui.period"),
      key: "period",
      render: (_, run) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => navigate(`/hr/payroll/${run.id}`)}
        >
          {formatPayrollPeriod(run.year, run.month, language)}
        </Button>
      ),
    },
    {
      title: t("payroll.ui.status"),
      key: "status",
      render: (_, run) => (
        <Space orientation="vertical" size={2}>
          <PayrollStatusTag status={run.status} />
          {run.status === "CANCELLED" && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("payroll.ui.cancelledOn", { date: "" })}
              <bdi dir="ltr">{formatDateTime(run.cancelled_at)}</bdi>
              {run.cancel_reason ? ` · ${run.cancel_reason}` : ""}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: t("payroll.ui.employees"),
      dataIndex: "total_employees",
      key: "total_employees",
    },
    {
      title: t("payroll.field.gross_salary"),
      key: "gross",
      align: "end",
      render: (_, run) => <MoneyText amount={run.total_gross} />,
    },
    {
      title: t("payroll.field.net_salary"),
      key: "total_net",
      align: "end",
      render: (_, run) => <MoneyText amount={run.total_net} />,
    },
    {
      title: t("payroll.field.total_company_cost"),
      key: "total_company_cost",
      align: "end",
      render: (_, run) => (
        <Space size={4} wrap style={{ justifyContent: "flex-end" }}>
          <MoneyText amount={run.total_company_cost} />
          {run.cost_incomplete && (
            <Tooltip title={t("payroll.ui.costIncompleteHelp")}>
              <span
                tabIndex={0}
                role="button"
                className="payroll-cost-marker"
                aria-label={t("payroll.field.cost_incomplete")}
              >
                *
              </span>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: t("payroll.ui.validation"),
      key: "validation",
      render: (_, run) =>
        run.validation_counts ? (
          <Space size={4}>
            <Tag color={run.validation_counts.errors ? "red" : "default"}>
              {t("payroll.ui.errorsCount", {
                count: run.validation_counts.errors,
              })}
            </Tag>
            <Tooltip title={t("payroll.ux3.apiCounts", run.validation_counts)}>
              <Text>
                {actionable[run.id] === undefined
                  ? t("payroll.ux.unavailable")
                  : t("payroll.ux3.actionableWarnings") +
                    ": " +
                    actionable[run.id]}
              </Text>
            </Tooltip>
          </Space>
        ) : (
          <Text type="secondary">{t("payroll.ux.unavailable")}</Text>
        ),
    },
  ];

  return (
    <PayrollTheme>
      <PageHeader
        title={t("payroll.ui.runsTitle")}
        subtitle={t("payroll.ui.runsSubtitle")}
        actions={
          <Space wrap>
            <Button
              icon={<SettingOutlined />}
              onClick={() => navigate("/hr/payroll/settings")}
            >
              {t("layout.payrollSettings")}
            </Button>
            <Button
              icon={<HomeOutlined />}
              onClick={() => navigate("/hr/payroll/accommodation")}
            >
              {t("layout.payrollAccommodation")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate("/hr/payroll/create")}
            >
              {t("payroll.createRun")}
            </Button>
          </Space>
        }
      />
      <Card style={{ borderRadius: 16 }}>
        <div className="payroll-finance-toolbar">
          <Select
            allowClear
            placeholder={t("payroll.year")}
            aria-label={t("payroll.year")}
            style={{ minWidth: 120 }}
            value={year}
            onChange={(value) => {
              setYear(value);
              setPage(1);
            }}
            options={yearOptions.map((value) => ({
              value,
              label: String(value),
            }))}
          />
          <Select
            allowClear
            placeholder={t("payroll.month")}
            aria-label={t("payroll.month")}
            style={{ minWidth: 160 }}
            value={month}
            onChange={(value) => {
              setMonth(value);
              setPage(1);
            }}
            options={monthOptions.map((value) => ({
              value,
              label: new Intl.DateTimeFormat(
                language === "ar" ? "ar-u-nu-latn" : "en-US",
                { month: "long", timeZone: "UTC" },
              ).format(new Date(Date.UTC(2000, value - 1, 1))),
            }))}
          />
          <Select
            allowClear
            placeholder={t("payroll.ui.status")}
            aria-label={t("payroll.ui.status")}
            style={{ minWidth: 160 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUSES.map((value) => ({
              value,
              label: <PayrollStatusTag status={value} />,
            }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            aria-label={t("payroll.ui.reload")}
          />
        </div>
        {error ? (
          <ErrorState
            title={t("payroll.ui.runsLoadFailed")}
            description={error}
            onRetry={() => void load()}
          />
        ) : !loading && runs.length === 0 ? (
          <EmptyState
            title={t("payroll.noRuns")}
            description={t("payroll.ui.runsEmpty")}
            actionText={t("payroll.createRun")}
            onAction={() => navigate("/hr/payroll/create")}
          />
        ) : (
          <ResponsiveTable<PayrollRunDto>
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={runs}
            pagination={{
              current: page,
              pageSize,
              total: count,
              showSizeChanger: true,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
          />
        )}
      </Card>
    </PayrollTheme>
  );
}
