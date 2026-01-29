import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, Col, Descriptions, Row, Table, Tag, Typography, Tabs, Modal, notification, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeftOutlined, LockOutlined, CheckCircleOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import EmptyState from "../../../components/ui/EmptyState";
import Unauthorized403Page from "../../Unauthorized403Page";
import PayrollPayslips from "./PayrollPayslips";
import PayrollReports from "./PayrollReports";

import type { PayrollRun, PayrollRunItem } from "../../../services/api/payrollApi";
import { getPayrollRunDetails, getPayrollRunItems, finalizePayrollRun } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

export default function PayrollRunDetailsPage() {
    const { run_id } = useParams<{ run_id: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Tab state management from URL
    const activeTab = searchParams.get("tab") || "overview";

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [finalizing, setFinalizing] = useState(false);

    const [run, setRun] = useState<PayrollRun | null>(null);
    const [items, setItems] = useState<PayrollRunItem[]>([]);
    const [totalItems, setTotalItems] = useState(0);

    // Pagination for items
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Columns for Items
    const columns: ColumnsType<PayrollRunItem> = [
        {
            title: "Employee",
            dataIndex: "employee_name",
            key: "employee_name",
            render: (text, record) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{text}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{record.position}</div>
                </div>
            )
        },
        {
            title: "Department",
            dataIndex: "department",
            key: "department",
        },
        {
            title: "Basic Salary",
            dataIndex: "basic_salary",
            key: "basic_salary",
            align: 'right',
            render: (val) => val?.toLocaleString(),
        },
        {
            title: "Allowances",
            dataIndex: "total_allowances",
            key: "total_allowances",
            align: 'right',
            render: (val) => val?.toLocaleString(),
        },
        {
            title: "Deductions",
            dataIndex: "total_deductions",
            key: "total_deductions",
            align: 'right',
            render: (val) => val ? `(${val.toLocaleString()})` : "0",
        },
        {
            title: "Net Salary",
            dataIndex: "net_salary",
            key: "net_salary",
            align: 'right',
            render: (val) => <span style={{ fontWeight: "bold" }}>{val?.toLocaleString()}</span>,
        },
    ];

    const loadData = useCallback(async () => {
        if (!run_id) return;

        setLoading(true);
        setError(null);
        setForbidden(false);

        try {
            // Fetch Run Details + Items in parallel
            const [runRes, itemsRes] = await Promise.all([
                getPayrollRunDetails(run_id),
                getPayrollRunItems(run_id, { page, page_size: pageSize })
            ]);

            if (isApiError(runRes)) {
                throw new Error(runRes.message || "Failed to load payroll run details");
            }
            if (isApiError(itemsRes)) {
                throw new Error(itemsRes.message || "Failed to load payroll items");
            }

            setRun(runRes.data);
            setItems(itemsRes.data.items || []);
            setTotalItems(itemsRes.data.count || 0);
            setLoading(false);

        } catch (err: any) {
            if (isForbidden(err)) {
                setForbidden(true);
                setLoading(false);
                return;
            }
            setError(err.message || "An error occurred fetching payroll data");
            setLoading(false);
        }
    }, [run_id, page, pageSize]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleTabChange = (key: string) => {
        setSearchParams({ tab: key });
    };

    const handleFinalize = () => {
        Modal.confirm({
            title: "Finalize Payroll Run?",
            icon: <LockOutlined style={{ color: "red" }} />,
            content: (
                <div>
                    <p>Are you sure you want to finalize this payroll run?</p>
                    <Alert
                        message="Warning"
                        description="Once finalized, the payroll cannot be edited. This action is irreversible."
                        type="warning"
                        showIcon
                    />
                </div>
            ),
            okText: "Finalize & Lock",
            okType: "danger",
            cancelText: "Cancel",
            onOk: async () => {
                if (!run) return;
                setFinalizing(true);
                try {
                    const res = await finalizePayrollRun(run.id);
                    if (isApiError(res)) {
                        notification.error({ message: "Finalization Failed", description: res.message });
                    } else {
                        notification.success({ message: "Success", description: "Payroll run finalized successfully." });
                        // Update local state
                        setRun(res.data);
                    }
                } catch (e: any) {
                    notification.error({ message: "Error", description: e.message || "Failed to finalize" });
                } finally {
                    setFinalizing(false);
                }
            }
        });
    };

    if (forbidden) return <Unauthorized403Page />;

    if (loading && !run) return <LoadingState title="Loading payroll details..." />;

    if (error && !run) return <ErrorState title="Error" description={error} onRetry={loadData} />;

    if (!run) return <EmptyState title="Not Found" description="Payroll run not found" actionText="Back to Dashboard" onAction={() => navigate("/hr/payroll")} />;

    const isFinalized = run.status === 'COMPLETED' || run.status === 'PAID';

    return (
        <div>
            <div style={{ marginBottom: 16 }}>
                <Button
                    type="link"
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate("/hr/payroll")}
                    style={{ paddingLeft: 0 }}
                >
                    Back to Dashboard
                </Button>
            </div>

            <PageHeader
                title={`Payroll Run: ${run.month}/${run.year}`}
                subtitle="Review and process payroll"
                actions={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Tag color={isFinalized ? 'green' : 'orange'}>
                            {isFinalized ? <><CheckCircleOutlined /> {run.status}</> : run.status}
                        </Tag>
                        {!isFinalized && run.status !== 'CANCELLED' && (
                            <Button
                                type="primary"
                                danger
                                icon={<LockOutlined />}
                                onClick={handleFinalize}
                                loading={finalizing}
                            >
                                Finalize Payroll
                            </Button>
                        )}
                    </div>
                }
            />

            <Tabs
                activeKey={activeTab}
                onChange={handleTabChange}
                items={[
                    {
                        key: 'overview',
                        label: 'Overview & Items',
                        children: (
                            <>
                                {/* Summary Cards */}
                                <Row gutter={16} style={{ marginBottom: 24 }}>
                                    <Col span={8}>
                                        <Card>
                                            <Descriptions title="Summary" column={1}>
                                                <Descriptions.Item label="Period">{run.month}/{run.year}</Descriptions.Item>
                                                <Descriptions.Item label="Total Employees">{run.total_employees}</Descriptions.Item>
                                            </Descriptions>
                                        </Card>
                                    </Col>
                                    <Col span={8}>
                                        <Card>
                                            <Descriptions title="Financials" column={1}>
                                                <Descriptions.Item label="Total Net Salary">
                                                    <Typography.Text strong style={{ fontSize: 18 }}>
                                                        {run.total_net?.toLocaleString()}
                                                    </Typography.Text>
                                                </Descriptions.Item>
                                                {/* Add other totals if available in the DTO later */}
                                            </Descriptions>
                                        </Card>
                                    </Col>
                                </Row>

                                <Card title="Employee Payslips (Review)" style={{ borderRadius: 16 }}>
                                    <Table
                                        dataSource={items}
                                        columns={columns}
                                        rowKey="id"
                                        loading={loading}
                                        pagination={{
                                            current: page,
                                            pageSize,
                                            total: totalItems,
                                            onChange: (p, ps) => {
                                                setPage(p);
                                                if (ps !== pageSize) setPageSize(ps);
                                            },
                                        }}
                                    />
                                </Card>
                            </>
                        )
                    },
                    {
                        key: 'payslips',
                        label: 'Payslips',
                        children: <PayrollPayslips runId={run.id} isFinalized={isFinalized} />
                    },
                    {
                        key: 'reports',
                        label: 'Reports',
                        children: <PayrollReports runId={run.id} status={run.status} />
                    }
                ]}
            />
        </div>
    );
}
