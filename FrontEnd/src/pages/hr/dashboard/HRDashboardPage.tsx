import { useEffect, useState } from "react";
import { Card, Col, Row, Button, Table, Avatar, Space, Tag } from "antd";
import {
    TeamOutlined,
    DollarOutlined,
    FileExclamationOutlined,
    ScheduleOutlined,
    UserAddOutlined,
    UploadOutlined,
    PlayCircleOutlined,
    FileTextOutlined,
    ArrowUpOutlined,
    UserOutlined
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getHrSummary } from "../../../services/api/hrSummaryApi";
import type { HRSummary } from "../../../services/api/hrSummaryApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

export default function HRDashboardPage() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [summary, setSummary] = useState<HRSummary | null>(null);

    /**
     * Load HR summary data
     */
    const loadSummary = async () => {
        setLoading(true);
        setError(null);
        setForbidden(false);

        try {
            const response = await getHrSummary();

            if (isApiError(response)) {
                setError(response.message || "Failed to load HR summary");
                setLoading(false);
                return;
            }

            setSummary(response.data);
            setLoading(false);
        } catch (err: any) {
            if (isForbidden(err)) {
                setForbidden(true);
                setLoading(false);
                return;
            }

            setError(err.message || "Failed to load HR summary");
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSummary();
    }, []);

    if (forbidden) return <Unauthorized403Page />;
    if (loading) return <LoadingState title="Loading dashboard..." />;
    if (error) return <ErrorState title="Failed to load dashboard" description={error} onRetry={loadSummary} />;

    const StatCard = ({ title, value, icon, color, trend }: any) => (
        <Card bordered={false} style={{ borderRadius: 12, height: '100%' }} bodyStyle={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ color: '#8c8c8c', fontSize: 14, marginBottom: 4 }}>{title}</div>
                    <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>{value}</div>
                    {trend && (
                        <div style={{ color: '#52c41a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <ArrowUpOutlined /> {trend} <span style={{ color: '#bfbfbf' }}>vs last month</span>
                        </div>
                    )}
                </div>
                <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `${color}15`, color: color, fontSize: 20
                }}>
                    {icon}
                </div>
            </div>
        </Card>
    );

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto" }}>
            <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Dashboard Overview</h2>

            {/* Stats Row */}
            <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Total Employees"
                        value={(summary?.total_employees || 0).toLocaleString()}
                        icon={<TeamOutlined />}
                        color="#1890ff"
                        trend="+5%"
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Active Payroll"
                        value="$142k"
                        icon={<DollarOutlined />}
                        color="#52c41a"
                        trend="+1.2%"
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Expiring Docs"
                        value={summary?.expiring_docs || 0}
                        icon={<FileExclamationOutlined />}
                        color="#faad14"
                        trend={null}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Pending Leave"
                        value={summary?.pending_leaves || 0}
                        icon={<ScheduleOutlined />}
                        color="#722ed1"
                        trend={null}
                    />
                </Col>
            </Row>

            {/* Quick Actions */}
            <div style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h3>
                <Space size={16} wrap>
                    <Button
                        type="primary"
                        icon={<UserAddOutlined />}
                        size="large"
                        style={{ background: '#ff7a45', borderColor: '#ff7a45', borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
                        onClick={() => navigate('/hr/employees/create')}
                    >
                        Add Employee
                    </Button>
                    <Button
                        icon={<UploadOutlined />}
                        size="large"
                        style={{ borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
                        onClick={() => navigate('/hr/import/employees')}
                    >
                        Upload Excel
                    </Button>
                    <Button
                        icon={<PlayCircleOutlined />}
                        size="large"
                        style={{ borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
                        onClick={() => navigate('/hr/payroll')}
                    >
                        Run Payroll
                    </Button>
                    <Button
                        icon={<FileTextOutlined />}
                        size="large"
                        style={{ borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
                    >
                        Reports
                    </Button>
                </Space>
            </div>

            <Row gutter={[24, 24]}>
                {/* Main Content: Recent Activity */}
                <Col xs={24} lg={16}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Recent Activity</h3>
                        <Button type="link" style={{ color: '#ff7a45' }}>View All</Button>
                    </div>
                    <Card bordered={false} style={{ borderRadius: 16, overflow: 'hidden' }} bodyStyle={{ padding: 0 }}>
                        <Table
                            dataSource={summary?.recent_activity || []}
                            pagination={false}
                            scroll={{ x: 600 }}
                            columns={[
                                {
                                    title: 'EMPLOYEE', dataIndex: 'employee', key: 'employee', render: (text) => (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <Avatar style={{ backgroundColor: '#f56a00' }}>{text[0]}</Avatar>
                                            <span style={{ fontWeight: 500 }}>{text}</span>
                                        </div>
                                    )
                                },
                                { title: 'ACTION TYPE', dataIndex: 'action', key: 'action', render: (t) => <span style={{ color: '#8c8c8c' }}>{t}</span> },
                                { title: 'DATE & TIME', dataIndex: 'date', key: 'date', render: (t) => <span style={{ color: '#8c8c8c' }}>{t}</span> },
                                {
                                    title: 'STATUS', dataIndex: 'status', key: 'status', render: (text, record) => (
                                        <Tag color={record.statusColor} style={{ borderRadius: 12, padding: '0 12px', border: 0 }}>
                                            {text}
                                        </Tag>
                                    )
                                },
                            ]}
                        />
                    </Card>
                </Col>

                {/* Sidebar: Approvals & System Status */}
                <Col xs={24} lg={8}>
                    <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Pending Approvals</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
                        {(summary?.pending_approvals || []).length === 0 && (
                            <Card bordered={false} style={{ borderRadius: 12, color: '#8c8c8c', textAlign: 'center' }}>
                                No pending approvals
                            </Card>
                        )}
                        {(summary?.pending_approvals || []).map(item => (
                            <Card key={item.id} bordered={false} style={{ borderRadius: 12 }} bodyStyle={{ padding: 16 }}>
                                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                                    <Avatar src={item.avatar} size={40} icon={<UserOutlined />} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontWeight: 600 }}>{item.name}</span>
                                            <span style={{ fontSize: 12, color: '#bfbfbf' }}>{item.time}</span>
                                        </div>
                                        <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>{item.action}</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="primary"
                                        size="small"
                                        style={{ background: '#ff7a45', borderColor: '#ff7a45', flex: 1, borderRadius: 6 }}
                                        onClick={() => navigate(`/hr/leave/requests/${item.id}`)}
                                    >
                                        Review
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>

                </Col>
            </Row>
        </div>
    );
}
