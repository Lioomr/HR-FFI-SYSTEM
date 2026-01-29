import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Col, Row, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import ErrorState from "../../../components/ui/ErrorState";
import EmptyState from "../../../components/ui/EmptyState";
import Unauthorized403Page from "../../Unauthorized403Page";

import type { PayrollRun } from "../../../services/api/payrollApi";
import { getPayrollRuns } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

const { Option } = Select;

export default function PayrollDashboardPage() {
    const navigate = useNavigate();

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);

    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [total, setTotal] = useState(0);

    // Filters
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [year, setYear] = useState<number>(new Date().getFullYear());

    // Columns
    const columns: ColumnsType<PayrollRun> = [
        {
            title: "ID",
            dataIndex: "id",
            key: "id",
            width: 80,
        },
        {
            title: "Period",
            key: "period",
            render: (_, record) => `${record.month}/${record.year}`,
            width: 120,
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status) => {
                let color = "default";
                if (status === "COMPLETED") color = "green";
                if (status === "DRAFT") color = "orange";
                if (status === "PAID") color = "blue";
                if (status === "CANCELLED") color = "red";
                return <Tag color={color}>{status}</Tag>;
            },
            width: 120,
        },
        {
            title: "Employees",
            dataIndex: "total_employees",
            key: "total_employees",
            align: 'right',
            width: 120,
        },
        {
            title: "Total Net",
            dataIndex: "total_net",
            key: "total_net",
            align: 'right',
            render: (val) => val ? val.toLocaleString() : "-",
        },
        {
            title: "Actions",
            key: "actions",
            render: (_, record) => (
                <Button size="small" onClick={() => navigate(`/hr/payroll/${record.id}`)}>
                    View
                </Button>
            ),
            width: 100,
        },
    ];

    const loadRuns = useCallback(async () => {
        setLoading(true);
        setError(null);
        setForbidden(false);

        try {
            const response = await getPayrollRuns({
                page,
                page_size: pageSize,
                year,
            });

            if (isApiError(response)) {
                setError(response.message || "Failed to load payroll runs");
                setLoading(false);
                return;
            }

            setRuns(response.data.items || []);
            setTotal(response.data.count || 0);
            setLoading(false);
        } catch (err: any) {
            if (isForbidden(err)) {
                setForbidden(true);
                setLoading(false);
                return;
            }
            setError(err.message || "Failed to load payroll runs");
            setLoading(false);
        }
    }, [page, pageSize, year]);

    useEffect(() => {
        loadRuns();
    }, [loadRuns]);

    if (forbidden) return <Unauthorized403Page />;

    return (
        <div>
            <PageHeader
                title="Payroll Runs"
                subtitle="Manage monthly payroll processing"
                actions={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate("/hr/payroll/create")}
                    >
                        Create Payroll Run
                    </Button>
                }
            />

            {/* Filter Bar */}
            <Card style={{ borderRadius: 16, marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
                <Row gutter={16} align="middle">
                    <Col>
                        <span style={{ marginRight: 8 }}>Year:</span>
                        <Select
                            value={year}
                            onChange={setYear}
                            style={{ width: 100 }}
                        >
                            {[0, 1, 2, 3].map(offset => {
                                const y = new Date().getFullYear() - offset;
                                return <Option key={y} value={y}>{y}</Option>;
                            })}
                        </Select>
                    </Col>
                </Row>
            </Card>

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={runs}
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
                        showSizeChanger: true,
                    }}
                    locale={{
                        emptyText: !loading && runs.length === 0 ? (
                            <EmptyState
                                title="No Payroll Runs Found"
                                description="Get started by creating a new payroll run."
                                actionText="Create Payroll Run"
                                onAction={() => navigate("/hr/payroll/create")}
                            />
                        ) : undefined
                    }}
                />
            </Card>

            {error && (
                <div style={{ marginTop: 16 }}>
                    <ErrorState title="Error" description={error} onRetry={loadRuns} />
                </div>
            )}
        </div>
    );
}
