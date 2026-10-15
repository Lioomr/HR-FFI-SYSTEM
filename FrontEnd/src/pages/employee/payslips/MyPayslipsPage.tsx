import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Select, Space, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, EyeOutlined } from "@ant-design/icons";
import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import ErrorState from "../../../components/ui/ErrorState";
import EmptyState from "../../../components/ui/EmptyState";
import PayrollTheme from "../../../components/payroll/PayrollTheme";
import MoneyText from "../../../components/payroll/MoneyText";
import { PayrollStatusTag } from "../../../components/payroll/payrollDisplay";
import {
  formatPayrollPeriod,
  paymentModeLabel,
} from "../../../components/payroll/payrollFormat";
import { useI18n } from "../../../i18n/useI18n";
import { triggerBlobDownload } from "../../../services/api/downloads";
import {
  downloadMyPayslip,
  listMyPayslips,
} from "../../../services/api/employeePayslipsApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../services/api/payrollErrors";
import type { EmployeePayslipListEntry } from "../../../services/api/payrollTypes";

/**
 * I: the employee's own payslips (contract 7.6). Only the whitelisted list
 * fields are read: period, net, payment mode and status.
 */
export default function MyPayslipsPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmployeePayslipListEntry[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [year, setYear] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listMyPayslips({ page, page_size: 25, year });
      if (current !== generation.current) return;
      setRows(data.items);
      setCount(data.count);
    } catch (err) {
      if (current !== generation.current) return;
      setError(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.payslipsLoadFailed"),
        ),
      );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [page, year, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (row: EmployeePayslipListEntry) => {
    setDownloadingId(row.id);
    try {
      const blob = await downloadMyPayslip(row.id);
      triggerBlobDownload(
        blob,
        `payslip_${row.year}_${String(row.month).padStart(2, "0")}.pdf`,
      );
    } catch (err) {
      message.error(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.downloadFailed"),
        ),
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const currentYear = new Date().getFullYear();
  const columns: ColumnsType<EmployeePayslipListEntry> = [
    {
      title: t("payroll.ui.period"),
      key: "period",
      render: (_, row) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => navigate(`/employee/payslips/${row.id}`)}
        >
          {formatPayrollPeriod(row.year, row.month, language)}
        </Button>
      ),
    },
    {
      title: t("payroll.field.net_salary"),
      key: "net",
      align: "end",
      render: (_, row) => <MoneyText amount={row.net_salary} strong />,
    },
    {
      title: t("payroll.pdf.payment_mode"),
      key: "payment_mode",
      render: (_, row) => paymentModeLabel(row.payment_mode, t),
    },
    {
      title: t("payroll.ui.status"),
      key: "status",
      render: (_, row) => <PayrollStatusTag status={row.status} />,
    },
    {
      title: t("payroll.ui.actions"),
      key: "actions",
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EyeOutlined />}
            aria-label={t("payroll.ui.viewPayslip")}
            onClick={() => navigate(`/employee/payslips/${row.id}`)}
          />
          <Button
            size="small"
            icon={<DownloadOutlined />}
            aria-label={t("payroll.ui.downloadPdf")}
            loading={downloadingId === row.id}
            onClick={() => void download(row)}
          />
        </Space>
      ),
    },
  ];

  return (
    <PayrollTheme>
      <PageHeader
        title={t("payroll.myPayslips")}
        subtitle={t("payroll.ui.myPayslipsSubtitle")}
      />
      <Card style={{ borderRadius: 16 }}>
        <Space style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder={t("payroll.year")}
            aria-label={t("payroll.year")}
            style={{ minWidth: 140 }}
            value={year}
            onChange={(value) => {
              setYear(value);
              setPage(1);
            }}
            options={Array.from({ length: 6 }, (_, i) => currentYear - i).map(
              (value) => ({ value, label: String(value) }),
            )}
          />
        </Space>
        {error ? (
          <ErrorState
            title={t("payroll.ui.payslipsLoadFailed")}
            description={error}
            onRetry={() => void load()}
          />
        ) : !loading && rows.length === 0 ? (
          <EmptyState
            title={t("payroll.noPayslips")}
            description={t("payroll.ui.payslipsEmpty")}
          />
        ) : (
          <ResponsiveTable<EmployeePayslipListEntry>
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize: 25,
              total: count,
              showSizeChanger: false,
              onChange: setPage,
            }}
          />
        )}
      </Card>
    </PayrollTheme>
  );
}
