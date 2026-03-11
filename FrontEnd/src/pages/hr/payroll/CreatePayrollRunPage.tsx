import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Col, Form, Grid, Row, Select, notification } from "antd";
import PageHeader from "../../../components/ui/PageHeader";
import { createPayrollRun, getPayrollRuns } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";

const { Option } = Select;
const { useBreakpoint } = Grid;

export default function CreatePayrollRunPage() {
    const navigate = useNavigate();
    const [form] = Form.useForm();
    const { t } = useI18n();
    const [submitting, setSubmitting] = useState(false);
    const screens = useBreakpoint();
    const isMobile = !screens.md;

    const handleSubmit = async (values: { year: number; month: number }) => {
        setSubmitting(true);

        try {
            notification.open({
                key: 'payroll_processing',
                message: t("payroll.processingTitle"),
                description: t("payroll.processingDesc"),
                icon: <div className="ant-spin ant-spin-spinning"><span className="ant-spin-dot ant-spin-dot-spin"><i className="ant-spin-dot-item"></i><i className="ant-spin-dot-item"></i><i className="ant-spin-dot-item"></i><i className="ant-spin-dot-item"></i></span></div>,
                duration: 0,
            });

            const response = await createPayrollRun(values);

            notification.destroy('payroll_processing');

            if (isApiError(response)) {
                // Handle 409 Conflict (Already Exists)
                // Standard axios error with response.status could be checked if we had the raw error object,
                // but our api wrapper often swallows it into 'errors'. 
                // We often see "status": "error", "message": "..." in the body.
                // If the message suggests "already exists" or similar, we can try to recover.
                const msg = response.message?.toLowerCase() || "";

                if (msg.includes("already exists") || msg.includes("unique constraint") || msg.includes("duplicate")) {
                    // Try to find the existing run
                    try {
                        const listRes = await getPayrollRuns({ year: values.year, page_size: 100 });
                        if (!isApiError(listRes)) {
                            // Find run for this month
                            const existing = listRes.data.items.find(r => r.month === values.month && r.year === values.year);
                            if (existing) {
                                notification.info({
                                    message: t("payroll.runExists"),
                                    description: t("payroll.runExistsDesc", { month: values.month, year: values.year }),
                                    duration: 3,
                                });
                                navigate(`/hr/payroll/${existing.id}`);
                                return;
                            }
                        }
                    } catch (findErr) {
                        // Failed to find it silently, rely on manual error
                    }

                    notification.warning({
                        message: t("payroll.alreadyExists"),
                        description: t("payroll.alreadyExistsDesc"),
                    });
                    setSubmitting(false);
                    return;
                }

                notification.error({
                    message: t("payroll.creationFail"),
                    description: response.message || t("payroll.creationFailDesc"),
                });
                setSubmitting(false);
                return;
            }

            notification.success({
                message: t("common.success"),
                description: t("payroll.creationSuccess"),
            });

            navigate(`/hr/payroll/${response.data.id}`);

        } catch (err: any) {
            const apiData = err?.apiData;
            const backendMessage = (apiData?.message || err?.message || "").toLowerCase();
            const backendErrors = Array.isArray(apiData?.errors)
                ? apiData.errors.map((e: any) => (typeof e === "string" ? e : e?.message || "")).join(" ").toLowerCase()
                : "";
            const duplicateDetected =
                err.response?.status === 409 ||
                err.message?.includes("409") ||
                err.response?.status === 422 && (backendMessage.includes("already exists") || backendErrors.includes("already exists") || backendErrors.includes("unique"));

            // Check for duplicate period and recover by opening existing run.
            if (duplicateDetected) {
                // Same recovery logic
                try {
                    const listRes = await getPayrollRuns({ year: values.year, page_size: 100 });
                    if (!isApiError(listRes) && listRes.data?.items) {
                        const existing = listRes.data.items.find(r => r.month === values.month && r.year === values.year);
                        if (existing) {
                            notification.info({
                                message: t("payroll.runExists"),
                                description: t("payroll.runExistsDesc2", { month: values.month, year: values.year }),
                                duration: 3
                            });
                            navigate(`/hr/payroll/${existing.id}`);
                            return;
                        }
                    }
                } catch (e) { }

                notification.warning({
                    message: t("payroll.alreadyExists"),
                    description: t("payroll.alreadyExistsDesc2"),
                });
            } else {
                notification.error({
                    message: t("common.error"),
                    description: err.message || t("payroll.unexpectedError"),
                });
            }
            setSubmitting(false);
        }
    };

    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1];
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    return (
        <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
            <PageHeader
                title={t("payroll.createTitle")}
                subtitle={t("payroll.createDesc")}
            />

            <Card style={{ borderRadius: 16 }}>
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                    initialValues={{
                        year: currentYear,
                        month: new Date().getMonth() + 1
                    }}
                >
                    <Row gutter={[16, 0]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name="year"
                                label={t("payroll.year")}
                                rules={[{ required: true, message: t("payroll.yearReq") }]}
                            >
                                <Select>
                                    {years.map(y => <Option key={y} value={y}>{y}</Option>)}
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name="month"
                                label={t("payroll.month")}
                                rules={[{ required: true, message: t("payroll.monthReq") }]}
                            >
                                <Select>
                                    {months.map(m => (
                                        <Option key={m} value={m}>
                                            {new Date(0, m - 1).toLocaleString('default', { month: 'long' })}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>

                    <div
                        style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            flexDirection: isMobile ? "column-reverse" : "row",
                            gap: 12,
                            marginTop: 24,
                        }}
                    >
                        <Button onClick={() => navigate("/hr/payroll")} block={isMobile}>
                            {t("common.cancel")}
                        </Button>
                        <Button type="primary" htmlType="submit" loading={submitting} block={isMobile}>
                            {t("payroll.createTitle")}
                        </Button>
                    </div>
                </Form>
            </Card>
        </div>
    );
}
