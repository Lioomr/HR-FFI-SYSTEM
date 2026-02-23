import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Descriptions, Divider, Typography } from "antd";
import { ArrowLeftOutlined, DownloadOutlined, ArrowRightOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import { getMyPayslip, downloadMyPayslipPdf, type EmployeePayslip } from "../../../services/api/employeePayslipsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { formatNumber } from "../../../utils/currency";
import { useI18n } from "../../../i18n/useI18n";

export default function EmployeePayslipDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t, language } = useI18n();
    const isRtl = language === 'ar';

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
            setError(e.message || t("payslips.details.failedLoad"));
        } finally {
            setLoading(false);
        }
    }, [id, t]);

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

    if (loading) return <LoadingState title={t("payslips.details.loading")} />;
    if (error) return <ErrorState title={t("common.error")} description={error} onRetry={loadData} />;
    if (!payslip) return <ErrorState title={t("common.notFound")} description={t("payslips.details.notFound")} />;

    return (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <Button
                type="link"
                icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />}
                onClick={() => navigate("/employee/payslips")}
                style={{ paddingInlineStart: 0, marginBottom: 16 }}
            >
                {t("payslips.details.back")}
            </Button>

            <PageHeader
                title={`${t("payslips.details.titlePrefix")} ${new Date(0, payslip.month - 1).toLocaleString('default', { month: 'long' })} ${payslip.year}`}
                actions={
                    <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={handleDownload}
                        loading={downloading}
                    >
                        {t("payslips.list.downloadPdf")}
                    </Button>
                }
            />

            <Card style={{ borderRadius: 16 }}>
                <Descriptions title={t("payslips.details.summary")} bordered column={1} labelStyle={{ width: 200 }}>
                    <Descriptions.Item label={t("payslips.list.colPeriod")}>{payslip.month}/{payslip.year}</Descriptions.Item>
                    <Descriptions.Item label={t("payslips.list.colStatus")}>{payslip.status}</Descriptions.Item>
                    <Descriptions.Item label={t("payslips.details.generatedDate")}>{payslip.generated_at ? new Date(payslip.generated_at).toLocaleDateString() : '-'}</Descriptions.Item>
                </Descriptions>

                <Divider />

                <Descriptions title={t("payslips.details.earnings")} bordered column={1} labelStyle={{ width: 200 }}>
                    <Descriptions.Item label={t("payroll.details.colBasicSalary")}>{formatNumber(payslip.basic_salary)}</Descriptions.Item>

                    {/* Allowances Breakdown */}
                    <Descriptions.Item label={t("payslips.details.transportation")}>{formatNumber(payslip.transportation_allowance)}</Descriptions.Item>
                    <Descriptions.Item label={t("payslips.details.accommodation")}>{formatNumber(payslip.accommodation_allowance)}</Descriptions.Item>
                    <Descriptions.Item label={t("payslips.details.telephone")}>{formatNumber(payslip.telephone_allowance)}</Descriptions.Item>
                    <Descriptions.Item label={t("payslips.details.petrol")}>{formatNumber(payslip.petrol_allowance)}</Descriptions.Item>
                    <Descriptions.Item label={t("payslips.details.other")}>{formatNumber(payslip.other_allowance)}</Descriptions.Item>

                    <Descriptions.Item label={t("payslips.details.totalAllowances")} contentStyle={{ fontWeight: 'bold' }}>
                        {formatNumber(payslip.total_allowances)}
                    </Descriptions.Item>

                    <Descriptions.Item label={t("payslips.details.grossSalary")} contentStyle={{ fontWeight: 'bold' }}>
                        {formatNumber(payslip.total_salary ?? (payslip.basic_salary + payslip.total_allowances))}
                    </Descriptions.Item>
                </Descriptions>

                <Divider />

                <Descriptions title={t("payslips.details.deductions")} bordered column={1} labelStyle={{ width: 200 }}>
                    <Descriptions.Item label={t("payslips.details.totalDeductions")} contentStyle={{ color: 'red' }}>
                        -{formatNumber(payslip.total_deductions)}
                    </Descriptions.Item>
                </Descriptions>

                <Divider />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
                    <Typography.Title level={4} style={{ margin: 0 }}>{t("payslips.list.colNetSalary")}</Typography.Title>
                    <Typography.Title level={3} style={{ margin: 0, color: '#1890ff' }}>
                        {formatNumber(payslip.net_salary)}
                    </Typography.Title>
                </div>
            </Card>
        </div>
    );
}
