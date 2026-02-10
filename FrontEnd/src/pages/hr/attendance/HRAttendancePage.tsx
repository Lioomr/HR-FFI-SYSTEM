import React, { useEffect, useState } from "react";
import { Table, Button, Card, Tag, message, Typography, Tabs, Space, Tooltip, Modal, Input } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useHrAttendanceStore } from "../../../stores/attendanceStore";
import type { AttendanceRecord, AttendanceStatus } from "../../../types/attendance";

const { Title } = Typography;
const { TextArea } = Input;

// Helper to get status color
const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
        case "PENDING": return "orange";
        case "PRESENT": return "green";
        case "LATE": return "gold";
        case "ABSENT": return "red";
        case "REJECTED": return "magenta";
        default: return "default";
    }
};

const HRAttendancePage: React.FC = () => {
    const {
        records,
        total,
        loading,
        fetchGlobalRecords,
        performOverride
    } = useHrAttendanceStore();

    const [activeTab, setActiveTab] = useState<string>("PENDING");
    const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

    // For Reject Modal
    const [rejectModalVisible, setRejectModalVisible] = useState(false);
    const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    const fetchData = () => {
        const params: any = {
            page: pagination.current,
            page_size: pagination.pageSize,
        };

        if (activeTab !== "ALL") {
            params.status = activeTab;
        }

        fetchGlobalRecords(params);
    };

    useEffect(() => {
        fetchData();
    }, [activeTab, pagination]);

    const handleApprove = async (record: AttendanceRecord) => {
        try {
            await performOverride(record.id, {
                status: "PRESENT",
                override_reason: "Approved by HR"
            });
            message.success(`Attendance for ${record.employee_name} approved!`);
            fetchData();
        } catch (err) {
            // Error handled by store
        }
    };

    const handleRejectClick = (record: AttendanceRecord) => {
        setSelectedRecordId(record.id);
        setRejectReason("");
        setRejectModalVisible(true);
    };

    const handleConfirmReject = async () => {
        if (!selectedRecordId) return;
        try {
            await performOverride(selectedRecordId, {
                status: "REJECTED",
                override_reason: rejectReason || "Rejected by HR"
            });
            message.success("Attendance rejected.");
            setRejectModalVisible(false);
            fetchData();
        } catch (err) {
            // Handled
        }
    };

    const columns = [
        {
            title: "Employee",
            dataIndex: "employee_name",
            key: "employee_name",
            render: (text: string, record: AttendanceRecord) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{text}</div>
                    <div style={{ fontSize: 12, color: "#8c8c8c" }}>{record.employee_email}</div>
                </div>
            )
        },
        {
            title: "Date",
            dataIndex: "date",
            key: "date",
            render: (val: string) => dayjs(val).format("MMM D, YYYY"),
        },
        {
            title: "Check In",
            dataIndex: "check_in_at",
            key: "check_in_at",
            render: (val: string) => val ? dayjs(val).format("HH:mm") : "—",
        },
        {
            title: "Check Out",
            dataIndex: "check_out_at",
            key: "check_out_at",
            render: (val: string) => val ? dayjs(val).format("HH:mm") : "—",
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status: AttendanceStatus) => (
                <Tag color={getStatusColor(status)}>{status}</Tag>
            ),
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: AttendanceRecord) => (
                <Space>
                    {record.status === "PENDING" && (
                        <>
                            <Tooltip title="Approve">
                                <Button
                                    type="primary"
                                    shape="circle"
                                    icon={<CheckCircleOutlined />}
                                    size="small"
                                    style={{ backgroundColor: '#52c41a' }}
                                    onClick={() => handleApprove(record)}
                                />
                            </Tooltip>
                            <Tooltip title="Reject">
                                <Button
                                    type="primary"
                                    danger
                                    shape="circle"
                                    icon={<CloseCircleOutlined />}
                                    size="small"
                                    onClick={() => handleRejectClick(record)}
                                />
                            </Tooltip>
                        </>
                    )}
                </Space>
            )
        }
    ];

    const tabItems = [
        { label: "Pending Approval", key: "PENDING" },
        { label: "Present", key: "PRESENT" },
        { label: "Absent", key: "ABSENT" },
        { label: "Late", key: "LATE" },
        { label: "Rejected", key: "REJECTED" },
        { label: "All Records", key: "ALL" },
    ];

    return (
        <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title level={2} style={{ margin: 0 }}>Attendance Management</Title>
                <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
            </div>

            <Card bordered={false} style={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <Tabs
                    activeKey={activeTab}
                    onChange={(key) => {
                        setActiveTab(key);
                        setPagination({ ...pagination, current: 1 });
                    }}
                    items={tabItems.map(item => ({
                        key: item.key,
                        label: item.label,
                    }))}
                />

                <Table
                    dataSource={records}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                        current: pagination.current,
                        pageSize: pagination.pageSize,
                        total: total,
                        onChange: (page, size) => setPagination({ current: page, pageSize: size }),
                        showSizeChanger: true
                    }}
                />
            </Card>

            <Modal
                title="Reject Attendance"
                open={rejectModalVisible}
                onOk={handleConfirmReject}
                onCancel={() => setRejectModalVisible(false)}
                okText="Reject"
                okButtonProps={{ danger: true }}
            >
                <Typography.Text>Please provide a reason for rejection:</Typography.Text>
                <TextArea
                    rows={4}
                    style={{ marginTop: 8 }}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Not at work location, Duplicate entry..."
                />
            </Modal>
        </div>
    );
};

export default HRAttendancePage;
