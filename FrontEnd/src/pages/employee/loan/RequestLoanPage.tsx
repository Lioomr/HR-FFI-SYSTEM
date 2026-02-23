import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Input, InputNumber, notification, Typography } from "antd";
import { ArrowLeftOutlined, SendOutlined, ArrowRightOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { createLoanRequest } from "../../../services/api/loanApi";
import { getEmployee, type Employee } from "../../../services/api/employeesApi";
import { isApiError } from "../../../services/api/apiTypes";
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

  useEffect(() => {
    getEmployee("me")
      .then((res) => {
        if (!isApiError(res)) setEmployee(res.data);
      })
      .catch(() => undefined);
  }, []);

  const maxAmount = useMemo(() => Number(employee?.basic_salary || 0), [employee]);

  async function onFinish(values: { amount: number; reason?: string }) {
    setSubmitting(true);
    try {
      const res = await createLoanRequest({
        amount: values.amount,
        reason: values.reason || "",
      });
      if (isApiError(res)) {
        notification.error({ message: t("loans.request.failedLoad"), description: res.message });
        return;
      }
      notification.success({ message: t("loans.request.submittedSuccess") });
      navigate("/employee/loans");
    } catch (err: any) {
      const description = err?.message || t("loans.request.failedLoad");
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
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            label={t("loans.request.formAmount")}
            name="amount"
            rules={[
              { required: true, message: t("loans.request.formAmountReq") },
              {
                validator: (_, value) => {
                  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
                    return Promise.reject(new Error(t("loans.request.formAmountGtZero")));
                  }
                  if (maxAmount > 0 && value > maxAmount) {
                    return Promise.reject(new Error(t("loans.request.formAmountExceedsLmit").replace('{limit}', formatNumber(maxAmount))));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber min={0} style={{ width: "100%" }} precision={2} placeholder={t("loans.request.formAmountPlaceholder")} />
          </Form.Item>
          <Form.Item label={t("loans.request.formReason")} name="reason">
            <TextArea rows={4} placeholder={t("loans.request.formReasonPlaceholder")} />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitting}>
            {t("loans.request.formSubmit")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
