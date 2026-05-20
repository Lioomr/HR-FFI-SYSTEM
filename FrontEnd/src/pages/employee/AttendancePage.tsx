import React, { useEffect } from "react";
import { Table, Button, Card, DatePicker, Row, Col, Typography, Tag, message } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEmployeeAttendanceStore } from "../../stores/attendanceStore";
import type { AttendanceStatus } from "../../types/attendance";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatTimeOnly12 } from "../../utils/dateTime";

const { Title } = Typography;
const { RangePicker } = DatePicker;

// Status colors
const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
        case "PRESENT": return "green";
        case "ABSENT": return "red";
        case "LATE": return "orange";
        case "PENDING":
        case "PENDING_HR":
        case "PENDING_MGR":
        case "PENDING_CEO":
            return "gold";
        case "REJECTED":
            return "magenta";
        default: return "default";
    }
};

const EmployeeAttendancePage: React.FC = () => {
    const { t } = useI18n();
    const {
        records,
        total,
        loading,
        error,
        fetchMyRecords,
        performCheckIn,
        performCheckOut
    } = useEmployeeAttendanceStore();

    const [dateRange, setDateRange] = React.useState<[dayjs.Dayjs, dayjs.Dayjs]>([
        dayjs().subtract(30, "day"),
        dayjs(),
    ]);

    const [pagination, setPagination] = React.useState({
        current: 1,
        pageSize: 25,
    });

    const fetchData = () => {
        fetchMyRecords({
            date_from: dateRange[0].format("YYYY-MM-DD"),
            date_to: dateRange[1].format("YYYY-MM-DD"),
            page: pagination.current,
            page_size: pagination.pageSize,
        });
    };

    useEffect(() => {
        fetchData();
    }, [dateRange, pagination]);

    useEffect(() => {
        if (error) {
            message.error(error);
        }
    }, [error]);

    const handleCheckIn = async () => {
        try {
            await performCheckIn();
            message.success(t("attendance.checkedIn"));
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
            // Store handles error state
        }
    };

    const handleCheckOut = async () => {
        try {
            await performCheckOut();
            message.success(t("attendance.checkedOut"));
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
            // Handled
        }
    };

    // Determine today's status for button states
    const todayStr = dayjs().format("YYYY-MM-DD");
    const todayRecord = records.find(r => r.date === todayStr);

    const isCheckInDisabled = !!todayRecord?.check_in_at;
    const isCheckOutDisabled = !todayRecord || !todayRecord.check_in_at || !!todayRecord.check_out_at;

    const columns = [
        {
            title: t("attendance.date"),
            dataIndex: "date",
            key: "date",
            width: 130,
            render: (val: string) => formatDateOnly(val),
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (status: AttendanceStatus) => (
                <Tag color={getStatusColor(status)}>{status}</Tag>
            ),
        },
        {
            title: t("attendance.checkInTime"),
            dataIndex: "check_in_at",
            key: "check_in_at",
            width: 120,
            responsive: ["sm" as const],
            render: (val: string | null) => formatTimeOnly12(val),
        },
        {
            title: t("attendance.checkOutTime"),
            dataIndex: "check_out_at",
            key: "check_out_at",
            width: 120,
            responsive: ["sm" as const],
            render: (val: string | null) => formatTimeOnly12(val),
        },
        {
            title: t("attendance.notes"),
            dataIndex: "notes",
            key: "notes",
            ellipsis: true,
            responsive: ["lg" as const],
        },
    ];

    return (
        <div>
            <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 16 }}>
                <Col xs={24} md="auto">
                    <Title level={2} style={{ margin: 0 }}>{t("attendance.myAttendance")}</Title>
                </Col>
                <Col xs={24} md="auto">
                    <Button icon={<ReloadOutlined />} onClick={fetchData}>{t("common.refresh")}</Button>
                </Col>
            </Row>

            <Card style={{ marginBottom: 16 }}>
                <Row justify="space-between" align="middle" gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                        <RangePicker
                            style={{ width: '100%' }}
                            value={dateRange}
                            onChange={(dates) => {
                                if (dates && dates[0] && dates[1]) {
                                    setDateRange([dates[0], dates[1]]);
                                }
                            }}
                        />
                    </Col>
                    <Col xs={24} md={12} style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <Button
                            type="primary"
                            icon={<ClockCircleOutlined />}
                            style={{ backgroundColor: isCheckInDisabled ? undefined : "#52c41a", flex: 1 }}
                            disabled={isCheckInDisabled}
                            loading={loading}
                            onClick={handleCheckIn}
                        >
                            {t("attendance.checkIn")}
                        </Button>
                        <Button
                            danger
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            style={{ flex: 1 }}
                            disabled={isCheckOutDisabled}
                            loading={loading}
                            onClick={handleCheckOut}
                        >
                            {t("attendance.checkOut")}
                        </Button>
                    </Col>
                </Row>
            </Card>

            <Table
                dataSource={records}
                columns={columns}
                rowKey="id"
                loading={loading}
                size="small"
                scroll={{ x: "max-content" }}
                pagination={{
                    current: pagination.current,
                    pageSize: pagination.pageSize,
                    total: total,
                    onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
                }}
            />
        </div>
    );
};

export default EmployeeAttendancePage;
