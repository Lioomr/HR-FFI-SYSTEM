import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Col, Grid, Row, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import ErrorState from "../../../components/ui/ErrorState";
import EmptyState from "../../../components/ui/EmptyState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { useI18n } from "../../../i18n/useI18n";

import type { PayrollRun } from "../../../services/api/payrollApi";
import { getPayrollRuns } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";

const { Option } = Select;
const { useBreakpoint } = Grid;

export default function PayrollDashboardPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const screens = useBreakpoint();
    const isMobile = !screens.md;

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
            title: t("payroll.period"),
            key: "period",
            render: (_, record) => `${record.month}/${record.year}`,
            width: 120,
        },
        {
            title: t("common.status"),
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
            title: t("payroll.employees"),
            dataIndex: "total_employees",
            key: "total_employees",
            align: 'right',
            width: 120,
        },
        {
            title: t("payroll.totalNet"),
            dataIndex: "total_net",
            key: "total_net",
            align: 'right',
            render: (val) => val !== null && val !== undefined ? <AmountWithSAR amount={val} /> : "-",
        },
        {
            title: t("common.actions"),
            key: "actions",
            render: (_, record) => (
                <Button size="small" onClick={() => navigate(`/hr/payroll/${record.id}`)}>
                    {t("payroll.view")}
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
                setError(response.message || t("common.tryAgain"));
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
            setError(err.message || t("common.tryAgain"));
            setLoading(false);
        }
    }, [page, pageSize, year, t]);

    useEffect(() => {
        loadRuns();
    }, [loadRuns]);

    if (forbidden) return <Unauthorized403Page />;

    return (
        <div>
            <PageHeader
                title={t("payroll.runs")}
                subtitle={t("payroll.title")}
                actions={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate("/hr/payroll/create")}
                        block={isMobile}
                    >
                        {t("payroll.createRun")}
                    </Button>
                }
            />

            <Card style={{ borderRadius: 16, marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col xs={24} sm={24} md="auto">
                        <Space
                            direction={isMobile ? "vertical" : "horizontal"}
                            size={8}
                            style={{ width: "100%", alignItems: isMobile ? "stretch" : "center" }}
                        >
                            <Typography.Text>{t("payroll.year")}:</Typography.Text>
                            <Select
                                value={year}
                                onChange={setYear}
                                style={{ width: isMobile ? "100%" : 120 }}
                            >
                                {[0, 1, 2, 3].map(offset => {
                                    const y = new Date().getFullYear() - offset;
                                    return <Option key={y} value={y}>{y}</Option>;
                                })}
                            </Select>
                        </Space>
                    </Col>
                    <Col xs={24} md="auto" flex={isMobile ? undefined : "1 1 auto"}>
                        <Typography.Text type="secondary">
                            {total > 0 ? `${total} ${t("payroll.runs")}` : t("payroll.title")}
                        </Typography.Text>
                    </Col>
                    <Col xs={24} md="auto">
                        <Select
                            value={pageSize}
                            onChange={value => {
                                setPage(1);
                                setPageSize(value);
                            }}
                            style={{ width: isMobile ? "100%" : 150 }}
                            options={[
                                { value: 10, label: "10 / page" },
                                { value: 20, label: "20 / page" },
                                { value: 50, label: "50 / page" },
                            ]}
                        />
                    </Col>
                </Row>
            </Card>

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={runs}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    scroll={{ x: 720 }}
                    size={isMobile ? "small" : "middle"}
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
                                title={t("payroll.noRuns")}
                                description={t("payroll.createRun")}
                                actionText={t("payroll.createRun")}
                                onAction={() => navigate("/hr/payroll/create")}
                            />
                        ) : undefined
                    }}
                />
            </Card>

            {error && (
                <div style={{ marginTop: 16 }}>
                    <ErrorState title={t("common.error")} description={error} onRetry={loadRuns} />
                </div>
            )}
        </div>
    );
}
