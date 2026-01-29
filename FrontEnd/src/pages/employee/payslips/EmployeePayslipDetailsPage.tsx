import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Descriptions, Divider, Typography } from "antd";
import { ArrowLeftOutlined, DownloadOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import { getMyPayslip, downloadMyPayslipPdf, type EmployeePayslip } from "../../../services/api/employeePayslipsApi";
import { isApiError } from "../../../services/api/apiTypes";

export default function EmployeePayslipDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [payslip, setPayslip] = useState<EmployeePayslip | null>(null);
    const [downloading, setDownloading] = useState(false);

    const loadData = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        try {
            const res = await getMyPayslip(id);
            if (isApiError(res)) {
                setError(res.message);
            } else {
                setPayslip(res.data);
            }
        } catch (e: any) {
            setError(e.message || "Failed to load payslip");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleDownload = async () => {
        if (!payslip) return;
        setDownloading(true);
        try {
            const blob = await downloadMyPayslipPdf(payslip.id);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `Payslip_${payslip.month}_${payslip.year}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            // Notification or alert handled by UI if desired, here mainly silent or toast
        } finally {
            setDownloading(false);
        }
    };

    if (loading) return <LoadingState title="Loading payslip details..." />;
    if (error) return <ErrorState title="Error" description={error} onRetry={loadData} />;
    if (!payslip) return <ErrorState title="Not Found" description="Payslip not found." />;

    return (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate("/employee/payslips")}
                style={{ paddingLeft: 0, marginBottom: 16 }}
            >
                Back to My Payslips
            </Button>

            <PageHeader
                title={`Payslip: ${new Date(0, payslip.month - 1).toLocaleString('default', { month: 'long' })} ${payslip.year}`}
                actions={
                    <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={handleDownload}
                        loading={downloading}
                    >
                        Download PDF
                    </Button>
                }
            />

            <Card style={{ borderRadius: 16 }}>
                <Descriptions title="Summary" bordered column={1} labelStyle={{ width: 200 }}>
                    <Descriptions.Item label="Period">{payslip.month}/{payslip.year}</Descriptions.Item>
                    <Descriptions.Item label="Status">{payslip.status}</Descriptions.Item>
                    <Descriptions.Item label="Generated Date">{payslip.generated_at ? new Date(payslip.generated_at).toLocaleDateString() : '-'}</Descriptions.Item>
                </Descriptions>

                <Divider />

                <Descriptions title="Earnings" bordered column={1} labelStyle={{ width: 200 }}>
                    <Descriptions.Item label="Basic Salary">{payslip.basic_salary?.toLocaleString()}</Descriptions.Item>

                    {/* Allowances Breakdown */}
                    <Descriptions.Item label="Transportation">{payslip.transportation_allowance?.toLocaleString() || "-"}</Descriptions.Item>
                    <Descriptions.Item label="Accommodation">{payslip.accommodation_allowance?.toLocaleString() || "-"}</Descriptions.Item>
                    <Descriptions.Item label="Telephone">{payslip.telephone_allowance?.toLocaleString() || "-"}</Descriptions.Item>
                    <Descriptions.Item label="Petrol">{payslip.petrol_allowance?.toLocaleString() || "-"}</Descriptions.Item>
                    <Descriptions.Item label="Other">{payslip.other_allowance?.toLocaleString() || "-"}</Descriptions.Item>

                    <Descriptions.Item label="Total Allowances" contentStyle={{ fontWeight: 'bold' }}>
                        {payslip.total_allowances?.toLocaleString()}
                    </Descriptions.Item>

                    <Descriptions.Item label="Gross Salary" contentStyle={{ fontWeight: 'bold' }}>
                        {payslip.total_salary?.toLocaleString() || (payslip.basic_salary + payslip.total_allowances).toLocaleString()}
                    </Descriptions.Item>
                </Descriptions>

                <Divider />

                <Descriptions title="Deductions" bordered column={1} labelStyle={{ width: 200 }}>
                    <Descriptions.Item label="Total Deductions" contentStyle={{ color: 'red' }}>
                        -{payslip.total_deductions?.toLocaleString()}
                    </Descriptions.Item>
                </Descriptions>

                <Divider />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
                    <Typography.Title level={4} style={{ margin: 0 }}>Net Salary</Typography.Title>
                    <Typography.Title level={3} style={{ margin: 0, color: '#1890ff' }}>
                        {payslip.net_salary?.toLocaleString()}
                    </Typography.Title>
                </div>
            </Card>
        </div>
    );
}
