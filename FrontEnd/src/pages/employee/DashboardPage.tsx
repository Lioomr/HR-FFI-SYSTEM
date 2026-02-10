import { useEffect, useState } from "react";
import { Card, Row, Col, Statistic, Button, Typography, Space } from "antd";
import {
    CalendarOutlined,
    FileTextOutlined,
    ClockCircleOutlined,
    UserOutlined
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { getEmployee } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";

const { Title, Text } = Typography;

export default function DashboardPage() {
    const navigate = useNavigate();
    const [employee, setEmployee] = useState<Employee | null>(null);

    useEffect(() => {
        getEmployee("me").then(res => {
            if (res.status === 'success') {
                setEmployee(res.data);
            }
        }).catch(() => { });
    }, []);

    const actions = [
        {
            title: "Check In / Out",
            icon: <ClockCircleOutlined style={{ fontSize: 24, color: '#1890ff' }} />,
            description: "Mark your daily attendance",
            link: "/employee/attendance",
            btnText: "Go to Attendance"
        },
        {
            title: "My Leaves",
            icon: <CalendarOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
            description: "Request and view leave status",
            link: "/employee/leaves",
            btnText: "Manage Leaves"
        },
        {
            title: "My Payslips",
            icon: <FileTextOutlined style={{ fontSize: 24, color: '#faad14' }} />,
            description: "View and download payslips",
            link: "/employee/payslips",
            btnText: "View Payslips"
        },
        {
            title: "My Profile",
            icon: <UserOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
            description: "View personal information",
            link: "/employee/profile",
            btnText: "View Profile"
        }
    ];

    return (
        <div>
            <PageHeader
                title={`Welcome back${employee ? ', ' + employee.full_name : ''}!`}
                subtitle="Employee Dashboard"
            />

            <Row gutter={[16, 16]}>
                {actions.map((action, index) => (
                    <Col xs={24} sm={12} md={6} key={index}>
                        <Card hoverable style={{ height: '100%', borderRadius: 8 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
                                {action.icon}
                                <div>
                                    <Title level={5} style={{ margin: 0 }}>{action.title}</Title>
                                    <Text type="secondary">{action.description}</Text>
                                </div>
                                <Button type="primary" ghost onClick={() => navigate(action.link)}>
                                    {action.btnText}
                                </Button>
                            </div>
                        </Card>
                    </Col>
                ))}
            </Row>

            <div style={{ marginTop: 24 }}>
                <Card title="Quick Stats" bordered={false} style={{ borderRadius: 8 }}>
                    <Row gutter={16}>
                        <Col span={8}>
                            <Statistic title="Employment Status" value={employee?.employment_status || "Active"} valueStyle={{ color: '#3f8600' }} />
                        </Col>
                        <Col span={8}>
                            {/* Placeholder for leave balance if we had it easily accessible without another API call */}
                            <Statistic title="Department" value={employee?.department || "—"} />
                        </Col>
                        <Col span={8}>
                            <Statistic title="Position" value={employee?.position || "—"} />
                        </Col>
                    </Row>
                </Card>
            </div>
        </div>
    );
}
