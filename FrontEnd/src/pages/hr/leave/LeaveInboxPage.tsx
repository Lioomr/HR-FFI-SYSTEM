import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification, Form, Select, DatePicker, Row, Col } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { getLeaveRequests, type LeaveRequest, type LeaveRequestFilter } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

const { Option } = Select;
const { RangePicker } = DatePicker;

export default function LeaveInboxPage() {
    const navigate = useNavigate();
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
                notification.error({ message: "Failed to load inbox", description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({ message: "Error", description: "Could not load leave requests" });
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
            case 'pending': return 'gold';
            case 'cancelled': return 'default';
            default: return 'default';
        }
    };

    const columns: ColumnsType<LeaveRequest> = [
        {
            title: "Employee",
            key: "employee",
            render: (_, record) => record.employee?.full_name || `ID: ${record.employee?.id}`
        },
        {
            title: "Leave Type",
            key: "leave_type",
            render: (_, record) => record.leave_type?.name || "-"
        },
        {
            title: "Start Date",
            dataIndex: "start_date",
            key: "start_date",
        },
        {
            title: "Days",
            dataIndex: "days", // Match backend
            key: "days",
            align: 'center'
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status) => {
                const display = (status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()).replace('_', ' ');
                return (
                    <Tag color={getStatusColor(status)}>
                        {display}
                    </Tag>
                );
            }
        },
        {
            title: "Created",
            dataIndex: "created_at",
            key: "created_at",
            render: (val) => val ? new Date(val).toLocaleDateString() : '-'
        },
        {
            title: "Actions",
            key: "actions",
            align: 'center',
            render: (_, record) => (
                <Tooltip title="View Details">
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
                title="Leave Request Inbox"
                subtitle="Manage employee leave requests"
            />

            <Card style={{ marginBottom: 16, borderRadius: 16 }}>
                <Form form={form} layout="vertical" onValuesChange={handleFilterChange}>
                    <Row gutter={16}>
                        <Col span={8}>
                            <Form.Item label="Status" name="status">
                                <Select placeholder="Filter by Status" allowClear>
                                    <Option value="submitted">Submitted</Option>
                                    <Option value="pending_manager">Pending Manager</Option>
                                    <Option value="pending_hr">Pending HR</Option>
                                    <Option value="approved">Approved</Option>
                                    <Option value="rejected">Rejected</Option>
                                    <Option value="cancelled">Cancelled</Option>
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label="Date Range" name="dates">
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
