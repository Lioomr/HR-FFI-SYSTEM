import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, Col, Descriptions, Row, Table, Tag, Typography, Tabs, Modal, notification, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeftOutlined, LockOutlined, CheckCircleOutlined, ArrowRightOutlined } from "@ant-design/icons";

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
import SARIcon from "../../../components/icons/SARIcon";
import { formatNumber } from "../../../utils/currency";
import { useI18n } from "../../../i18n/useI18n";

export default function PayrollRunDetailsPage() {
    const { run_id } = useParams<{ run_id: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { t, language } = useI18n();
    const isRtl = language === 'ar';

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
            title: t("payroll.runDetails.colEmployee"),
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
            title: t("reference.departments.title"),
            dataIndex: "department",
            key: "department",
        },
        {
            title: t("payroll.details.colBasicSalary"),
            dataIndex: "basic_salary",
            key: "basic_salary",
            align: 'right',
            render: (val) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {formatNumber(val)}
                    <SARIcon size={12} />
                </span>
            ),
        },
        {
            title: t("payroll.runDetails.colAllowances"),
            dataIndex: "total_allowances",
            key: "total_allowances",
            align: 'right',
            render: (val) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {formatNumber(val)}
                    <SARIcon size={12} />
                </span>
            ),
        },
        {
            title: t("payroll.runDetails.colDeductions"),
            dataIndex: "total_deductions",
            key: "total_deductions",
            align: 'right',
            render: (val) => val ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    ({formatNumber(val)})
                    <SARIcon size={12} />
                </span>
            ) : "0",
        },
        {
            title: t("payslips.list.colNetSalary"),
            dataIndex: "net_salary",
            key: "net_salary",
            align: 'right',
            render: (val) => (
                <span style={{ fontWeight: "bold", display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {formatNumber(val)}
                    <SARIcon size={12} />
                </span>
            ),
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
                throw new Error(runRes.message || t("payroll.runDetails.failedLoadDetails"));
            }
            if (isApiError(itemsRes)) {
                throw new Error(itemsRes.message || t("payroll.runDetails.failedLoadItems"));
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
            setError(err.message || t("payroll.runDetails.fetchError"));
            setLoading(false);
        }
    }, [run_id, page, pageSize, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleTabChange = (key: string) => {
        setSearchParams({ tab: key });
    };

    const handleFinalize = () => {
        Modal.confirm({
            title: t("payroll.runDetails.finalizeConfirmTitle"),
            icon: <LockOutlined style={{ color: "red" }} />,
            content: (
                <div>
                    <p>{t("payroll.runDetails.finalizeConfirmText")}</p>
                    <Alert
                        message={t("payroll.runDetails.finalizeConfirmWarningTitle")}
                        description={t("payroll.runDetails.finalizeConfirmWarningDesc")}
                        type="warning"
                        showIcon
                    />
                </div>
            ),
            okText: t("payroll.runDetails.finalizeConfirmOkBtn"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: async () => {
                if (!run) return;
                setFinalizing(true);
                try {
                    const res = await finalizePayrollRun(run.id);
                    if (isApiError(res)) {
                        notification.error({ message: t("payroll.runDetails.finalizeFailed"), description: res.message });
                    } else {
                        notification.success({ message: t("common.success"), description: t("payroll.runDetails.finalizeSuccess") });
                        // Update local state
                        setRun(res.data);
                    }
                } catch (e: any) {
                    notification.error({ message: t("common.error"), description: e.message || t("payroll.runDetails.finalizeFailed") });
                } finally {
                    setFinalizing(false);
                }
            }
        });
    };

    if (forbidden) return <Unauthorized403Page />;

    if (loading && !run) return <LoadingState title={t("payroll.runDetails.loadingDetails")} />;

    if (error && !run) return <ErrorState title={t("common.error")} description={error} onRetry={loadData} />;

    if (!run) return <EmptyState title={t("common.notFound")} description={t("payroll.runDetails.notFound")} actionText={t("payroll.runDetails.backToDashboard")} onAction={() => navigate("/hr/payroll")} />;

    const isFinalized = run.status === 'COMPLETED' || run.status === 'PAID';

    return (
        <div>
            <div style={{ marginBottom: 16 }}>
                <Button
                    type="link"
                    icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />}
                    onClick={() => navigate("/hr/payroll")}
                    style={{ paddingInlineStart: 0 }}
                >
                    {t("payroll.runDetails.backToDashboard")}
                </Button>
            </div>

            <PageHeader
                title={`${t("payroll.history.colRun")} ${run.month}/${run.year}`}
                subtitle={t("payroll.runDetails.subtitle")}
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
                                {t("payroll.runDetails.finalizeBtn")}
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
                        label: t("payroll.runDetails.tabOverview"),
                        children: (
                            <>
                                {/* Summary Cards */}
                                <Row gutter={16} style={{ marginBottom: 24 }}>
                                    <Col span={8}>
                                        <Card>
                                            <Descriptions title={t("payroll.runDetails.summary")} column={1}>
                                                <Descriptions.Item label={t("payslips.list.colPeriod")}>{run.month}/{run.year}</Descriptions.Item>
                                                <Descriptions.Item label={t("payroll.runDetails.totalEmployees")}>{run.total_employees}</Descriptions.Item>
                                            </Descriptions>
                                        </Card>
                                    </Col>
                                    <Col span={8}>
                                        <Card>
                                            <Descriptions title={t("payroll.runDetails.financials")} column={1}>
                                                <Descriptions.Item label={t("payroll.runDetails.totalNetSalary")}>
                                                    <Typography.Text strong style={{ fontSize: 18, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                        {formatNumber(run.total_net)}
                                                        <SARIcon size={18} />
                                                    </Typography.Text>
                                                </Descriptions.Item>
                                                {/* Add other totals if available in the DTO later */}
                                            </Descriptions>
                                        </Card>
                                    </Col>
                                </Row>

                                <Card title={t("payroll.runDetails.employeePayslipsReview")} style={{ borderRadius: 16 }}>
                                    <Table
                                        dataSource={items}
                                        columns={columns}
                                        rowKey="id"
                                        loading={loading}
                                        scroll={{ x: 800 }}
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
                        label: t("payroll.runDetails.tabPayslips"),
                        children: (
                            <PayrollPayslips
                                runId={run.id}
                                isFinalized={isFinalized}
                                runStatus={run.status}
                                onGenerated={loadData}
                            />
                        )
                    },
                    {
                        key: 'reports',
                        label: t("payroll.runDetails.reportsTitle"),
                        children: <PayrollReports runId={run.id} status={run.status} />
                    }
                ]}
            />
        </div>
    );
}
