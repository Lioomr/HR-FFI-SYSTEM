import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined, DownloadOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { getMyPayslips, downloadMyPayslipPdf, type EmployeePayslip } from "../../../services/api/employeePayslipsApi";
import { isApiError } from "../../../services/api/apiTypes";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";

export default function EmployeePayslipsListPage() {
    const navigate = useNavigate();
    const { t, language } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<EmployeePayslip[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [downloadingId, setDownloadingId] = useState<number | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getMyPayslips({ page, page_size: pageSize });
            if (isApiError(res)) {
                notification.error({ message: t("payslips.list.failedLoad"), description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({
                message: t("common.error"),
                description: err.message || t("payslips.list.failedLoad")
            });
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleDownload = async (item: EmployeePayslip) => {
        setDownloadingId(item.id);
        try {
            const blob = await downloadMyPayslipPdf(item.id);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `Payslip_${item.month}_${item.year}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            notification.error({ message: t("payslips.list.downloadFailed"), description: t("payslips.list.couldNotDownloadPdf") });
        } finally {
            setDownloadingId(null);
        }
    };

    const columns: ColumnsType<EmployeePayslip> = [
        {
            title: t("payslips.list.colPeriod"),
            key: "period",
            render: (_, r) => {
                const monthName = new Date(0, r.month - 1).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long' });
                return <span>{monthName} {r.year}</span>;
            }
        },
        {
            title: t("payslips.list.colNetSalary"),
            dataIndex: "net_salary",
            key: "net_salary",
            align: 'right',
            render: (val) => <AmountWithSAR amount={val} />,
        },
        {
            title: t("payslips.list.colPaymentMode"),
            dataIndex: "payment_mode",
            key: "payment_mode",
            render: (val) => {
                if (!val) return "-";
                // Map backend strings like "Bank Transfer" or "Cash" to translation keys
                const key = val.toLowerCase().replace(/\s+/g, ''); // "Bank Transfer" -> "banktransfer"
                const tKey = `paymentMode.${key}`;
                // Fallback to raw value if translation doesn't exist
                const translated = t(tKey);
                return translated === tKey ? val : translated;
            }
        },
        {
            title: t("payslips.list.colStatus"),
            dataIndex: "status",
            key: "status",
            render: (status) => {
                const s = (status || '').toLowerCase();
                return (
                    <Tag color={s === 'paid' ? 'green' : 'blue'}>
                        {t(`status.${s}`)}
                    </Tag>
                );
            }
        },
        {
            title: t("common.actions"),
            key: "actions",
            align: 'center',
            render: (_, record) => (
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <Tooltip title={t("payslips.list.viewDetails")}>
                        <Button
                            icon={<EyeOutlined />}
                            onClick={() => navigate(`/employee/payslips/${record.id}`)}
                            size="small"
                        />
                    </Tooltip>
                    <Tooltip title={t("payslips.list.downloadPdf")}>
                        <Button
                            icon={<DownloadOutlined />}
                            onClick={() => handleDownload(record)}
                            loading={downloadingId === record.id}
                            size="small"
                        />
                    </Tooltip>
                </div>
            ),
        },
    ];

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <PageHeader
                title={t("payslips.list.title")}
                subtitle={t("payslips.list.subtitle")}
            />

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={data}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    scroll={{ x: 800 }}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        onChange: (p, ps) => {
                            setPage(p);
                            if (ps !== pageSize) setPageSize(ps);
                        },
                    }}
                />
            </Card>
        </div>
    );
}
