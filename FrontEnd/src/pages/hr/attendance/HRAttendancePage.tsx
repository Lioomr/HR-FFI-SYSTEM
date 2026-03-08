import React, { useEffect, useState } from "react";
import { Table, Button, Card, Tag, message, Typography, Tabs, Space, Tooltip, Modal, Input } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useHrAttendanceStore } from "../../../stores/attendanceStore";
import type { AttendanceRecord, AttendanceStatus } from "../../../types/attendance";
import dayjs from "dayjs";
import { useI18n } from "../../../i18n/useI18n";

const { Title } = Typography;
const { TextArea } = Input;

// Helper to get status color
const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
        case "PENDING": return "orange";
        case "PENDING_HR": return "orange";
        case "PENDING_MGR": return "gold";
        case "PENDING_CEO": return "purple";
        case "PRESENT": return "green";
        case "LATE": return "gold";
        case "ABSENT": return "red";
        case "REJECTED": return "magenta";
        default: return "default";
    }
};

const HRAttendancePage: React.FC = () => {
    const { t } = useI18n();
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
    const [selectedRecordId, setSelectedRecordId] = useState<number | string | null>(null);
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
            message.success(t("hr.attendance.approvedSuccess", { name: record.employee_name }));
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
            message.success(t("hr.attendance.rejectedSuccess"));
            setRejectModalVisible(false);
            fetchData();
        } catch (err) {
            // Handled
        }
    };

    const columns = [
        {
            title: t("hr.dashboard.employee"),
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
            title: t("common.date"),
            dataIndex: "date",
            key: "date",
            render: (val: string) => dayjs(val).format("MMM D, YYYY"),
        },
        {
            title: t("attendance.checkIn"),
            dataIndex: "check_in_at",
            key: "check_in_at",
            render: (val: string) => val ? dayjs(val).format("HH:mm") : "—",
        },
        {
            title: t("attendance.checkOut"),
            dataIndex: "check_out_at",
            key: "check_out_at",
            render: (val: string) => val ? dayjs(val).format("HH:mm") : "—",
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            render: (status: AttendanceStatus) => {
                // Determine display text for status tag
                let displayStatus = status;
                switch (status) {
                    case "PENDING": displayStatus = t("status.pending") as any; break;
                    case "PRESENT": displayStatus = t("status.active") as any; break;
                    case "ABSENT": displayStatus = t("status.absent") as any; break;
                    case "LATE": displayStatus = t("hr.attendance.late") as any; break;
                    case "REJECTED": displayStatus = t("status.rejected") as any; break;
                    case "PENDING_HR": displayStatus = t("status.pendingHr") as any; break;
                    case "PENDING_MGR": displayStatus = t("status.pendingManager") as any; break;
                    case "PENDING_CEO": displayStatus = t("status.pendingCeo") as any; break;
                }
                return <Tag color={getStatusColor(status)}>{displayStatus}</Tag>;
            },
        },
        {
            title: t("common.actions"),
            key: "actions",
            render: (_: any, record: AttendanceRecord) => (
                <Space>
                    {["PENDING", "PENDING_HR", "PENDING_MGR"].includes(record.status) && (
                        <>
                            <Tooltip title={t("common.approve")}>
                                <Button
                                    type="primary"
                                    shape="circle"
                                    icon={<CheckCircleOutlined />}
                                    size="small"
                                    style={{ backgroundColor: '#52c41a' }}
                                    onClick={() => handleApprove(record)}
                                />
                            </Tooltip>
                            <Tooltip title={t("common.reject")}>
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
        { label: t("hr.attendance.pendingApproval"), key: "PENDING" },
        { label: t("hr.attendance.present"), key: "PRESENT" },
        { label: t("hr.attendance.absent"), key: "ABSENT" },
        { label: t("hr.attendance.late"), key: "LATE" },
        { label: t("hr.attendance.rejected"), key: "REJECTED" },
        { label: t("hr.attendance.allRecords"), key: "ALL" },
    ];

    return (
        <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title level={4} style={{ margin: 0 }}>{t("hr.attendance.title")}</Title>
                <Button icon={<ReloadOutlined />} onClick={fetchData}>{t("common.refresh")}</Button>
            </div>

            <Card bordered={false} style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
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
                title={t("hr.attendance.rejectTitle")}
                open={rejectModalVisible}
                onOk={handleConfirmReject}
                onCancel={() => setRejectModalVisible(false)}
                okText={t("common.reject")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
            >
                <Typography.Text>{t("hr.attendance.rejectReasonLabel")}</Typography.Text>
                <TextArea
                    rows={4}
                    style={{ marginTop: 8 }}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={t("hr.attendance.rejectPlaceholder")}
                />
            </Modal>
        </div>
    );
};

export default HRAttendancePage;
