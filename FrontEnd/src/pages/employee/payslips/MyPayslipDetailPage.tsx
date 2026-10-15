import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Space,
  Typography,
  message,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import PageHeader from "../../../components/ui/PageHeader";
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

function LineRow({
  label,
  amount,
  note,
  strong,
}: {
  label: string;
  amount: Money | null;
  note?: string;
  strong?: boolean;
}) {
  return (
    <tr className="payroll-payslip-line">
      <td>
        <Text strong={strong}>{label}</Text>
        {note && (
          <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 6 }}>
            {note}
          </Text>
        )}
      </td>
      <td>
        <MoneyText amount={amount} strong={strong} />
      </td>
    </tr>
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

  return (
    <PayrollTheme>
      <PageHeader
        title={t("payroll.ui.payslipTitle", { period })}
        tags={<PayrollStatusTag status={payslip.status} />}
        actions={
          <Space wrap>
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
        }
      />

      {payslip.legacy_calculation && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("payroll.ui.legacyPayslip")}
        />
      )}

      <div className="payroll-payslip-summary">
        {[
          ["net_salary", payslip.net_salary],
          ["gross_salary", payslip.gross_salary],
          ["total_deductions", payslip.total_deductions],
        ].map(([field, amount]) => (
          <div key={field}>
            <Text type="secondary">{t(`payroll.field.${field}`)}</Text>
            <MoneyText amount={amount} strong size={22} />
          </div>
        ))}
      </div>
      <Text type="secondary">
        {t("payroll.pdf.payment_mode")}:{" "}
        {paymentModeLabel(payslip.payment_mode, t)}
      </Text>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={t("payroll.pdf.earnings")}
            style={{ borderRadius: 16, height: "100%" }}
          >
            <table
              className="payroll-payslip-lines"
              aria-label={t("payroll.pdf.earnings")}
            >
              <tbody>
                {payslip.salary_components.map((line) => (
                  <LineRow
                    key={line.type}
                    label={label(line)}
                    amount={line.amount}
                  />
                ))}
                <LineRow
                  label={t("payroll.field.gross_salary")}
                  amount={payslip.gross_salary}
                  strong
                />
              </tbody>
            </table>
            {payslip.additions.length > 0 && (
              <>
                <Text strong style={{ display: "block", marginTop: 16 }}>
                  {t("payroll.pdf.additions")}
                </Text>
                <table
                  className="payroll-payslip-lines"
                  aria-label={t("payroll.pdf.additions")}
                >
                  <tbody>
                    {payslip.additions.map((line, index) => (
                      <LineRow
                        key={`${line.type}-${index}`}
                        label={label(line)}
                        amount={line.amount}
                        note={lineNote(line)}
                      />
                    ))}
                    <LineRow
                      label={t("payroll.field.total_additions")}
                      amount={payslip.total_additions}
                      strong
                    />
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={t("payroll.pdf.deductions")}
            style={{ borderRadius: 16, height: "100%" }}
          >
            {payslip.deductions.length === 0 ? (
              <Text type="secondary">{t("payroll.ui.noDeductions")}</Text>
            ) : null}
            <table
              className="payroll-payslip-lines"
              aria-label={t("payroll.pdf.deductions")}
            >
              <tbody>
                {payslip.deductions.map((line, index) => (
                  <LineRow
                    key={`${line.type}-${index}`}
                    label={label(line)}
                    amount={line.amount}
                    note={lineNote(line)}
                  />
                ))}
                <LineRow
                  label={t("payroll.field.total_deductions")}
                  amount={payslip.total_deductions}
                  strong
                />
              </tbody>
            </table>
          </Card>
        </Col>
      </Row>
    </PayrollTheme>
  );
}
