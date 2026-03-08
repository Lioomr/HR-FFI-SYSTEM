import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Input, InputNumber, notification, Select, Typography } from "antd";
import { ArrowLeftOutlined, SendOutlined, ArrowRightOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { createLoanRequest } from "../../../services/api/loanApi";
import { getEmployee, type Employee } from "../../../services/api/employeesApi";
import { isApiError, type ApiError } from "../../../services/api/apiTypes";
import { getHttpStatus } from "../../../services/api/httpErrors";
import { formatNumber } from "../../../utils/currency";
import { useI18n } from "../../../i18n/useI18n";

const { TextArea } = Input;

export default function RequestLoanPage() {
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const isRtl = language === 'ar';
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const selectedLoanType = Form.useWatch("loan_type", form) as "open" | "installment" | undefined;
  const selectedAmount = Form.useWatch("amount", form) as number | undefined;
  const selectedInstallmentMonths = Form.useWatch("installment_months", form) as number | undefined;

  useEffect(() => {
    getEmployee("me")
      .then((res) => {
        if (!isApiError(res)) setEmployee(res.data);
      })
      .catch(() => undefined);
  }, []);

  const maxAmount = useMemo(() => Number(employee?.basic_salary || 0), [employee]);
  const openLimit = useMemo(() => (maxAmount > 0 ? maxAmount * 0.25 : 0), [maxAmount]);
  const monthlyDeductionPreview = useMemo(() => {
    const amount = typeof selectedAmount === "number" && !Number.isNaN(selectedAmount) ? selectedAmount : 0;
    if (amount <= 0) return 0;
    if (selectedLoanType === "installment") {
      const months =
        typeof selectedInstallmentMonths === "number" && !Number.isNaN(selectedInstallmentMonths)
          ? selectedInstallmentMonths
          : 0;
      if (months <= 0) return 0;
      return amount / months;
    }
    return amount;
  }, [selectedAmount, selectedInstallmentMonths, selectedLoanType]);

  function getLoanRequestErrorDescription(error: unknown): string {
    const status = getHttpStatus(error);
    if (status === 401) return t("loans.request.error.unauthorized");
    if (status === 403) return t("loans.request.error.forbidden");
    if (status === 422 || status === 400) return t("loans.request.error.validation");
    if (status !== undefined && status >= 500) return t("loans.request.error.server");

    const errObj = error as { message?: unknown; code?: unknown } | undefined;
    const rawMessage = typeof errObj?.message === "string" ? errObj.message.trim() : "";
    const lowerMessage = rawMessage.toLowerCase();
    const code = typeof errObj?.code === "string" ? errObj.code : "";

    if (code === "ECONNABORTED" || lowerMessage.includes("timeout")) {
      return t("loans.request.error.timeout");
    }

    if (lowerMessage.includes("network")) {
      return t("loans.request.error.network");
    }

    if (lowerMessage === "server error") {
      return t("loans.request.error.server");
    }

    if (rawMessage) {
      return rawMessage;
    }

    return t("loans.request.error.generic");
  }

  function getApiMessageDescription(apiError: ApiError): string {
    const firstError = Array.isArray(apiError.errors) && apiError.errors.length > 0 ? apiError.errors[0] : undefined;
    if (typeof firstError === "string" && firstError.trim()) {
      return firstError;
    }
    if (firstError && typeof firstError === "object" && "message" in firstError) {
      const msg = String(firstError.message || "").trim();
      if (msg) return msg;
    }
    const message = apiError.message;
    const normalized = (message || "").trim().toLowerCase();
    if (!normalized) return t("loans.request.error.generic");
    if (normalized === "server error") return t("loans.request.error.server");
    return translateBackendLoanValidationMessage(message);
  }

  function translateBackendLoanValidationMessage(message?: string): string {
    const raw = (message || "").trim();
    if (!raw) return t("loans.request.error.generic");
    const normalized = raw.toLowerCase();

    if (normalized.includes("employee profile not found")) return t("loans.request.error.profileNotFound");
    if (normalized.includes("only active employees can request loans")) return t("loans.request.error.inactiveEmployee");
    if (normalized.includes("basic salary is not configured")) return t("loans.request.error.basicSalaryMissing");
    if (normalized.includes("last 10 days of the month")) return t("loans.request.error.openLoanWindow");
    if (normalized.includes("installment months are only for installment loans")) {
      return t("loans.request.error.installmentMonthsOnlyForInstallment");
    }
    if (normalized.includes("installment months are required for installment loans")) {
      return t("loans.request.error.installmentMonthsRequired");
    }
    if (normalized.includes("requires a configured joining date")) {
      return t("loans.request.error.installmentNeedsJoinDate");
    }
    if (normalized.includes("at least 6 months of service")) {
      return t("loans.request.error.installmentMinService");
    }
    if (normalized.includes("loan amount cannot exceed your basic salary")) {
      return t("loans.request.error.exceedsBasicSalary");
    }

    const openLimitMatch = raw.match(/Open loan amount cannot exceed 25% of basic salary \(([^)]+)\)\.?/i);
    if (openLimitMatch) {
      return t("loans.request.error.openExceedsLimit", { limit: openLimitMatch[1] });
    }

    return raw;
  }

  async function onFinish(values: { amount: number; reason?: string; loan_type: "open" | "installment"; installment_months?: number }) {
    setSubmitting(true);
    try {
      const res = await createLoanRequest({
        amount: values.amount,
        reason: values.reason || "",
        loan_type: values.loan_type,
        installment_months: values.loan_type === "installment" ? values.installment_months ?? null : null,
      });
      if (isApiError(res)) {
        notification.error({
          message: t("loans.request.failedLoad"),
          description: getApiMessageDescription(res),
        });
        return;
      }
      notification.success({ message: t("loans.request.submittedSuccess") });
      navigate("/employee/loans");
    } catch (err: unknown) {
      const description = getLoanRequestErrorDescription(err);
      notification.error({ message: t("loans.request.failedLoad"), description });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <Button type="link" icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} onClick={() => navigate("/employee/loans")} style={{ paddingInlineStart: 0 }}>
        {t("loans.details.back")}
      </Button>
      <PageHeader title={t("loans.request.title")} subtitle={t("loans.request.subtitle")} />
      <Card style={{ borderRadius: 16 }}>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <strong>{t("loans.request.limitLabel")}</strong> {formatNumber(maxAmount)}
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 16 }}>
          <strong>{t("loans.request.openLimitLabel")}</strong> {formatNumber(openLimit)}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ loan_type: "open" }}>
          <Form.Item
            label={t("loans.request.formLoanType")}
            name="loan_type"
            rules={[{ required: true, message: t("loans.request.formLoanTypeReq") }]}
          >
            <Select
              options={[
                { value: "open", label: t("loans.request.loanTypeOpen") },
                { value: "installment", label: t("loans.request.loanTypeInstallment") },
              ]}
            />
          </Form.Item>
          <Form.Item
            label={t("loans.request.formAmount")}
            name="amount"
            rules={[
              { required: true, message: t("loans.request.formAmountReq") },
              {
                validator: (_, value) => {
                  const loanType = form.getFieldValue("loan_type") as "open" | "installment" | undefined;
                  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
                    return Promise.reject(new Error(t("loans.request.formAmountGtZero")));
                  }
                  if (loanType === "open") {
                    if (openLimit > 0 && value > openLimit) {
                      return Promise.reject(
                        new Error(t("loans.request.formAmountExceedsLmit").replace("{limit}", formatNumber(openLimit))),
                      );
                    }
                  } else if (maxAmount > 0 && value > maxAmount) {
                    return Promise.reject(
                      new Error(t("loans.request.formAmountExceedsLmit").replace("{limit}", formatNumber(maxAmount))),
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber min={0} style={{ width: "100%" }} precision={2} placeholder={t("loans.request.formAmountPlaceholder")} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.loan_type !== next.loan_type}>
            {({ getFieldValue }) =>
              getFieldValue("loan_type") === "installment" ? (
                <Form.Item
                  label={t("loans.request.formInstallmentMonths")}
                  name="installment_months"
                  rules={[
                    { required: true, message: t("loans.request.formInstallmentMonthsReq") },
                    { type: "number", min: 1, max: 10, message: t("loans.request.formInstallmentMonthsRange") },
                  ]}
                >
                  <InputNumber min={1} max={10} style={{ width: "100%" }} placeholder={t("loans.request.formInstallmentMonthsPlaceholder")} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item label={t("loans.request.formReason")} name="reason">
            <TextArea rows={4} placeholder={t("loans.request.formReasonPlaceholder")} />
          </Form.Item>
          <Typography.Paragraph style={{ marginTop: 4, marginBottom: 12 }}>
            <strong>{t("loans.request.monthlyDeductionLabel")}</strong> {formatNumber(monthlyDeductionPreview)}
          </Typography.Paragraph>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitting}>
            {t("loans.request.formSubmit")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
