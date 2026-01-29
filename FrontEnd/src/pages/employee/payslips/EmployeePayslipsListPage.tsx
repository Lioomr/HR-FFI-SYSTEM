import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined, DownloadOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { getMyPayslips, downloadMyPayslipPdf, type EmployeePayslip } from "../../../services/api/employeePayslipsApi";
import { isApiError } from "../../../services/api/apiTypes";

export default function EmployeePayslipsListPage() {
    const navigate = useNavigate();
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
                notification.error({ message: "Failed to load payslips", description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({
                message: "Error",
                description: err.message || "Failed to load payslips"
            });
        } finally {
            setLoading(false);
        }
    }, [page, pageSize]);

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
            notification.error({ message: "Download Failed", description: "Could not download PDF." });
        } finally {
            setDownloadingId(null);
        }
    };

    const columns: ColumnsType<EmployeePayslip> = [
        {
            title: "Period",
            key: "period",
            render: (_, r) => <span>{new Date(0, r.month - 1).toLocaleString('default', { month: 'long' })} {r.year}</span>
        },
        {
            title: "Net Salary",
            dataIndex: "net_salary",
            key: "net_salary",
            align: 'right',
            render: (val) => val?.toLocaleString(),
        },
        {
            title: "Payment Mode",
            dataIndex: "payment_mode",
            key: "payment_mode",
            render: (val) => val || "-"
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status) => (
                <Tag color={status === 'paid' ? 'green' : 'blue'}>
                    {status?.toUpperCase()}
                </Tag>
            )
        },
        {
            title: "Actions",
            key: "actions",
            align: 'center',
            render: (_, record) => (
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <Tooltip title="View Details">
                        <Button
                            icon={<EyeOutlined />}
                            onClick={() => navigate(`/employee/payslips/${record.id}`)}
                            size="small"
                        />
                    </Tooltip>
                    <Tooltip title="Download PDF">
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
                title="My Payslips"
                subtitle="View and download your monthly payslips"
            />

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={data}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
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
