import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Space, Typography, message } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import BackButton from "../../../components/ui/BackButton";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import PayrollTheme from "../../../components/payroll/PayrollTheme";
import MoneyText from "../../../components/payroll/MoneyText";
import { PayrollStatusTag } from "../../../components/payroll/payrollDisplay";
import {
  formatPayrollPeriod,
  paymentModeLabel,
} from "../../../components/payroll/payrollFormat";
import { useI18n } from "../../../i18n/useI18n";
import { isNotFound } from "../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../services/api/downloads";
import {
  downloadMyPayslip,
  getMyPayslipDetail,
} from "../../../services/api/employeePayslipsApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../services/api/payrollErrors";
import type {
  EmployeePayslipDetail,
  EmployeePayslipLine,
  Money,
  SalaryComponentLine,
} from "../../../services/api/payrollTypes";

const { Text } = Typography;

// Distinct dot colors for the salary components, in their listed order.
const EARNING_COLORS = [
  "#ea580c",
  "#f59e0b",
  "#0ea5e9",
  "#8b5cf6",
  "#14b8a6",
  "#64748b",
];

/** A line amount the API sent as exactly zero (null stays visible: Unknown). */
function isZeroMoney(amount: Money | null) {
  return amount !== null && Number(amount) === 0;
}

function Figure({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "net" | "negative";
  children: ReactNode;
}) {
  return (
    <div className={`pslip-figure${tone ? ` pslip-figure--${tone}` : ""}`}>
      <Text type="secondary" className="pslip-figure-label">
        {label}
      </Text>
      {children}
    </div>
  );
}

type PaneRow = {
  key: string;
  label: string;
  amount: Money | null;
  note?: string;
  color: string;
};

function LinesPane({
  title,
  total,
  rows,
  empty,
  negative,
}: {
  title: string;
  total: Money | null;
  rows: PaneRow[];
  empty: string;
  negative?: boolean;
}) {
  return (
    <div className={`pslip-pane${negative ? " pslip-pane--negative" : ""}`}>
      <div className="pslip-pane-head">
        <span>{title}</span>
        <MoneyText amount={total} strong />
      </div>
      {rows.length === 0 ? (
        <Text type="secondary" className="pslip-none">
          {empty}
        </Text>
      ) : (
        <table className="pslip-lines" aria-label={title}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <span
                    className="pslip-dot"
                    style={{ background: row.color }}
                    aria-hidden="true"
                  />
                  {row.label}
                  {row.note ? (
                    <span className="pslip-note">{row.note}</span>
                  ) : null}
                </td>
                <td className="pslip-amount">
                  <MoneyText amount={row.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * I: one payslip for its owner (contract DTO EP). Renders only the whitelist:
 * salary components, additions, collected itemised deductions, net, status,
 * period and payment mode. No provisions or company cost can appear here:
 * the API module drops them before this page sees the data.
 */
export default function MyPayslipDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const [payslip, setPayslip] = useState<EmployeePayslipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getMyPayslipDetail(id);
      if (current !== generation.current) return;
      setPayslip(next);
    } catch (err) {
      if (current !== generation.current) return;
      if (isNotFound(err)) setNotFound(true);
      else
        setError(
          payrollErrorSummary(
            parsePayrollError(err),
            t("payroll.ui.payslipLoadFailed"),
          ),
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async () => {
    if (!payslip) return;
    setDownloading(true);
    try {
      const blob = await downloadMyPayslip(payslip.id);
      triggerBlobDownload(
        blob,
        `payslip_${payslip.year}_${String(payslip.month).padStart(2, "0")}.pdf`,
      );
    } catch (err) {
      message.error(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.downloadFailed"),
        ),
      );
    } finally {
      setDownloading(false);
    }
  };

  if (loading && !payslip) return <LoadingState />;
  if (notFound) {
    return (
      <ErrorState
        title={t("payroll.ui.payslipNotFound")}
        onRetry={() => navigate("/employee/payslips")}
      />
    );
  }
  if (!payslip || error) {
    return (
      <ErrorState
        title={t("payroll.ui.payslipLoadFailed")}
        description={error ?? undefined}
        onRetry={() => void load()}
      />
    );
  }

  const label = (line: SalaryComponentLine | EmployeePayslipLine) =>
    line.label || t(line.label_key) || line.type;
  const lineNote = (line: EmployeePayslipLine) => {
    const parts: string[] = [];
    if (line.quantity)
      parts.push(t("payroll.ui.quantityValue", { quantity: line.quantity }));
    if (
      line.source_period &&
      (line.source_period.year !== payslip.year ||
        line.source_period.month !== payslip.month)
    ) {
      parts.push(
        t("payroll.ui.fromPeriod", {
          period: formatPayrollPeriod(
            line.source_period.year,
            line.source_period.month,
            language,
          ),
        }),
      );
    }
    return parts.join(" · ") || undefined;
  };
  const period = formatPayrollPeriod(payslip.year, payslip.month, language);
  // Zero allowances add nothing to read; the footer says they were hidden.
  const earnings = payslip.salary_components.filter(
    (line) => !isZeroMoney(line.amount),
  );
  const hiddenZeroCount = payslip.salary_components.length - earnings.length;
  const hasDeductions = !isZeroMoney(payslip.total_deductions);
  // Display-only proportions for the bar: what the employee kept versus what
  // was deducted. Every amount shown is the API's own exact value.
  const netValue = Number(payslip.net_salary);
  const deductedValue = Number(payslip.total_deductions);
  const shares =
    payslip.net_salary !== null &&
    payslip.total_deductions !== null &&
    netValue >= 0 &&
    deductedValue >= 0 &&
    netValue + deductedValue > 0
      ? {
          net: (netValue / (netValue + deductedValue)) * 100,
          deducted: (deductedValue / (netValue + deductedValue)) * 100,
        }
      : null;

  return (
    <PayrollTheme>
      {payslip.legacy_calculation && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("payroll.ui.legacyPayslip")}
        />
      )}

      <section className="pslip" aria-label={t("payroll.ui.flow.label")}>
        <div className="pslip-head">
          <div className="pslip-heading">
            <span className="pslip-eyebrow">
              {t("payroll.ui.flow.eyebrow")}
            </span>
            <div className="pslip-title-row">
              <h1 className="pslip-title">{period}</h1>
              <PayrollStatusTag status={payslip.status} />
            </div>
          </div>
          <Space wrap className="pslip-actions">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading}
              onClick={() => void download()}
            >
              {t("payroll.ui.downloadPdf")}
            </Button>
            <BackButton
              onClick={() => navigate("/employee/payslips")}
              style={{ minHeight: 40 }}
            >
              {t("payroll.myPayslips")}
            </BackButton>
          </Space>
        </div>
        <div className="pslip-flow">
          <div className="pslip-figures">
            <Figure label={t("payroll.field.gross_salary")}>
              <MoneyText amount={payslip.gross_salary} strong size={17} />
            </Figure>
            <span className="pslip-op" aria-hidden="true">
              +
            </span>
            <Figure label={t("payroll.field.total_additions")}>
              <MoneyText amount={payslip.total_additions} strong size={17} />
            </Figure>
            <span className="pslip-op" aria-hidden="true">
              {"\u2212"}
            </span>
            <Figure
              label={t("payroll.field.total_deductions")}
              tone={hasDeductions ? "negative" : undefined}
            >
              <MoneyText amount={payslip.total_deductions} strong size={17} />
            </Figure>
            <span className="pslip-op" aria-hidden="true">
              =
            </span>
            <Figure label={t("payroll.field.net_salary")} tone="net">
              <MoneyText amount={payslip.net_salary} strong size={30} />
            </Figure>
          </div>
          {shares ? (
            <div className="pslip-bar" aria-hidden="true">
              <i
                className="pslip-bar-net"
                style={{ width: `${shares.net}%` }}
              />
              {shares.deducted > 0 ? (
                <i
                  className="pslip-bar-deducted"
                  style={{ width: `${shares.deducted}%` }}
                />
              ) : null}
            </div>
          ) : null}
          <div className="pslip-keys">
            {shares ? (
              <span>
                <i className="pslip-key pslip-key-net" aria-hidden="true" />
                {t("payroll.ui.flow.netShare", {
                  percent: Math.round(shares.net),
                })}
              </span>
            ) : null}
            {shares && shares.deducted > 0 ? (
              <span>
                <i
                  className="pslip-key pslip-key-deducted"
                  aria-hidden="true"
                />
                {t("payroll.ui.flow.deductedShare", {
                  percent: Math.round(shares.deducted),
                })}
              </span>
            ) : null}
            <span>
              {t("payroll.pdf.payment_mode")}:{" "}
              {paymentModeLabel(payslip.payment_mode, t)}
            </span>
          </div>
        </div>

        <div className="pslip-panes">
          <LinesPane
            title={t("payroll.pdf.earnings")}
            total={payslip.gross_salary}
            empty={t("payroll.ui.flow.noneThisMonth")}
            rows={earnings.map((line, index) => ({
              key: line.type,
              label: label(line),
              amount: line.amount,
              color: EARNING_COLORS[index % EARNING_COLORS.length],
            }))}
          />
          <LinesPane
            title={t("payroll.pdf.additions")}
            total={payslip.total_additions}
            empty={t("payroll.ui.flow.noneThisMonth")}
            rows={payslip.additions.map((line, index) => ({
              key: `${line.type}-${index}`,
              label: label(line),
              amount: line.amount,
              note: lineNote(line),
              color: "#3b82f6",
            }))}
          />
          <LinesPane
            title={t("payroll.pdf.deductions")}
            total={payslip.total_deductions}
            empty={t("payroll.ui.noDeductions")}
            negative={hasDeductions}
            rows={payslip.deductions.map((line, index) => ({
              key: `${line.type}-${index}`,
              label: label(line),
              amount: line.amount,
              note: lineNote(line),
              color: "#e11d48",
            }))}
          />
        </div>

        {hiddenZeroCount > 0 ? (
          <div className="pslip-foot">{t("payroll.ui.flow.zeroHidden")}</div>
        ) : null}
      </section>
    </PayrollTheme>
  );
}
