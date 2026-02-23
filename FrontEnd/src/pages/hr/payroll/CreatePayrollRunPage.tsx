import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Select, notification } from "antd";
import PageHeader from "../../../components/ui/PageHeader";
import { createPayrollRun, getPayrollRuns } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";

const { Option } = Select;

export default function CreatePayrollRunPage() {
    const navigate = useNavigate();
    const [form] = Form.useForm();
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (values: { year: number; month: number }) => {
        setSubmitting(true);

        try {
            notification.open({
                key: 'payroll_processing',
                message: 'Processing Payroll',
                description: 'Calculating salaries and generating payslips for all active employees...',
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
                                    message: "Payroll Run Exists",
                                    description: `A run for ${values.month}/${values.year} already exists. Opening it...`,
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
                        message: "Already Exists",
                        description: "A payroll run for this period already exists.",
                    });
                    setSubmitting(false);
                    return;
                }

                notification.error({
                    message: "Creation Failed",
                    description: response.message || "Could not create payroll run.",
                });
                setSubmitting(false);
                return;
            }

            notification.success({
                message: "Success",
                description: "Payroll run created successfully",
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
                                message: "Payroll Run Exists",
                                description: `Opening existing run for ${values.month}/${values.year}...`,
                                duration: 3
                            });
                            navigate(`/hr/payroll/${existing.id}`);
                            return;
                        }
                    }
                } catch (e) { }

                notification.warning({
                    message: "Already Exists",
                    description: "A payroll run for this period already exists, but could not be automatically located.",
                });
            } else {
                notification.error({
                    message: "Error",
                    description: err.message || "An unexpected error occurred",
                });
            }
            setSubmitting(false);
        }
    };

    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1];
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    return (
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <PageHeader
                title="Create Payroll Run"
                subtitle="Select the period for the new payroll run"
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
                    <Form.Item
                        name="year"
                        label="Year"
                        rules={[{ required: true, message: "Please select a year" }]}
                    >
                        <Select>
                            {years.map(y => <Option key={y} value={y}>{y}</Option>)}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="month"
                        label="Month"
                        rules={[{ required: true, message: "Please select a month" }]}
                    >
                        <Select>
                            {months.map(m => (
                                <Option key={m} value={m}>
                                    {new Date(0, m - 1).toLocaleString('default', { month: 'long' })}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
                        <Button onClick={() => navigate("/hr/payroll")}>Cancel</Button>
                        <Button type="primary" htmlType="submit" loading={submitting}>
                            Create Payroll Run
                        </Button>
                    </div>
                </Form>
            </Card>
        </div>
    );
}
