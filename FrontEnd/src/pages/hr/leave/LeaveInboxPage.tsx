import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification, Form, Select, DatePicker, Row, Col } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { getLeaveRequests, type LeaveRequest, type LeaveRequestFilter } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";

const { Option } = Select;
const { RangePicker } = DatePicker;

export default function LeaveInboxPage() {
    const navigate = useNavigate();
    const { t } = useI18n();

    // Translate leave type names from the API
    const translateLeaveType = (name?: string): string => {
        if (!name) return '-';
        const key = `leave.type.${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '')}`;
        const translated = t(key);
        return translated === key ? name : translated;
    };

    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<LeaveRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Filters
    const [filters, setFilters] = useState<LeaveRequestFilter>({});
    const [form] = Form.useForm();

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getLeaveRequests({ ...filters, page, page_size: pageSize });
            if (isApiError(res)) {
                notification.error({ message: t("error.generic"), description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({ message: t("common.error"), description: t("leave.noRequests") });
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, filters]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleFilterChange = (values: any) => {
        const newFilters: LeaveRequestFilter = {};
        if (values.status) newFilters.status = values.status;
        if (values.dates && values.dates[0]) {
            newFilters.date_from = values.dates[0].format("YYYY-MM-DD");
            newFilters.date_to = values.dates[1].format("YYYY-MM-DD");
        }
        setFilters(newFilters);
        setPage(1); // Reset to first page
    };

    const getStatusColor = (status: string) => {
        const s = status?.toLowerCase();
        switch (s) {
            case 'approved': return 'green';
            case 'rejected': return 'red';
            case 'submitted': return 'blue';
            case 'pending_manager': return 'orange';
            case 'pending_hr': return 'purple';
            case 'pending_ceo': return 'volcano';
            case 'pending': return 'gold';
            case 'cancelled': return 'default';
            default: return 'default';
        }
    };

    const columns: ColumnsType<LeaveRequest> = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_, record) => record.employee?.full_name || `ID: ${record.employee?.id}`
        },
        {
            title: t("leave.leaveType"),
            key: "leave_type",
            render: (_, record) => translateLeaveType(record.leave_type?.name)
        },
        {
            title: t("leave.startDate"),
            dataIndex: "start_date",
            key: "start_date",
        },
        {
            title: t("leave.days"),
            dataIndex: "days",
            key: "days",
            align: 'center'
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            render: (status) => {
                const statusKey = `leave.status.${status?.toLowerCase()}`;
                const translated = t(statusKey);
                const display = translated === statusKey
                    ? (status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()).replace(/_/g, ' ')
                    : translated;
                return (
                    <Tag color={getStatusColor(status)}>
                        {display}
                    </Tag>
                );
            }
        },
        {
            title: t("common.createdAt"),
            dataIndex: "created_at",
            key: "created_at",
            render: (val) => val ? new Date(val).toLocaleDateString() : '-'
        },
        {
            title: t("common.actions"),
            key: "actions",
            align: 'center',
            render: (_, record) => (
                <Tooltip title={t("common.details")}>
                    <Button
                        icon={<EyeOutlined />}
                        onClick={() => navigate(`/hr/leave/requests/${record.id}`)}
                        size="small"
                    />
                </Tooltip>
            ),
        },
    ];

    return (
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <PageHeader
                title={t("leave.title")}
                subtitle={t("layout.leaveInbox")}
            />

            <Card style={{ marginBottom: 16, borderRadius: 16 }}>
                <Form form={form} layout="vertical" onValuesChange={handleFilterChange}>
                    <Row gutter={16}>
                        <Col span={8}>
                            <Form.Item label={t("common.status")} name="status">
                                <Select placeholder={t("employees.list.statusPlaceholder")} allowClear>
                                    <Option value="submitted">{t("status.pending")}</Option>
                                    <Option value="pending_manager">{t("status.pendingManager")}</Option>
                                    <Option value="pending_hr">{t("status.pendingHr")}</Option>
                                    <Option value="pending_ceo">{t("status.pendingCeo")}</Option>
                                    <Option value="approved">{t("status.approved")}</Option>
                                    <Option value="rejected">{t("status.rejected")}</Option>
                                    <Option value="cancelled">{t("status.cancelled")}</Option>
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label={t("leave.startDate") + " - " + t("leave.endDate")} name="dates">
                                <RangePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Card>

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
