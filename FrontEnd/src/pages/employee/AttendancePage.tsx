import React, { useEffect } from "react";
import { Table, Button, Card, DatePicker, Row, Col, Typography, Tag, message } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEmployeeAttendanceStore } from "../../stores/attendanceStore";
import type { AttendanceStatus } from "../../types/attendance";

const { Title } = Typography;
const { RangePicker } = DatePicker;

// Status colors
const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
        case "PRESENT": return "green";
        case "ABSENT": return "red";
        case "LATE": return "orange";
        default: return "default";
    }
};

const EmployeeAttendancePage: React.FC = () => {
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
            message.success("Successfully checked in!");
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
            // Store handles error state, toast shown via effect or we can show it here
        }
    };

    const handleCheckOut = async () => {
        try {
            await performCheckOut();
            message.success("Successfully checked out!");
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
            // Handled
        }
    };

    // Determine today's status for button states
    // We can look at the latest record if it's today
    const todayStr = dayjs().format("YYYY-MM-DD");
    const todayRecord = records.find(r => r.date === todayStr);

    // Disable Check In if: today record exists AND check_in_at is present
    const isCheckInDisabled = !!todayRecord?.check_in_at;

    // Disable Check Out if: today record does NOT exist OR check_in_at is missing OR check_out_at is already present
    const isCheckOutDisabled = !todayRecord || !todayRecord.check_in_at || !!todayRecord.check_out_at;

    const columns = [
        {
            title: "Date",
            dataIndex: "date",
            key: "date",
            render: (val: string) => dayjs(val).format("MMM D, YYYY"),
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
            title: "Check In",
            dataIndex: "check_in_at",
            key: "check_in_at",
            render: (val: string | null) => val ? dayjs(val).format("hh:mm A") : "-",
        },
        {
            title: "Check Out",
            dataIndex: "check_out_at",
            key: "check_out_at",
            render: (val: string | null) => val ? dayjs(val).format("hh:mm A") : "-",
        },
        {
            title: "Notes",
            dataIndex: "notes",
            key: "notes",
        },
    ];

    return (
        <div>
            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Col>
                    <Title level={2}>My Attendance</Title>
                </Col>
                <Col>
                    <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
                </Col>
            </Row>

            <Card style={{ marginBottom: 16 }}>
                <Row justify="space-between" align="middle">
                    <Col>
                        <RangePicker
                            value={dateRange}
                            onChange={(dates) => {
                                if (dates && dates[0] && dates[1]) {
                                    setDateRange([dates[0], dates[1]]);
                                }
                            }}
                        />
                    </Col>
                    <Col>
                        <Button
                            type="primary"
                            icon={<ClockCircleOutlined />}
                            style={{ marginRight: 8, backgroundColor: isCheckInDisabled ? undefined : "#52c41a" }}
                            disabled={isCheckInDisabled}
                            loading={loading}
                            onClick={handleCheckIn}
                        >
                            Check In
                        </Button>
                        <Button
                            danger
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            disabled={isCheckOutDisabled}
                            loading={loading}
                            onClick={handleCheckOut}
                        >
                            Check Out
                        </Button>
                    </Col>
                </Row>
            </Card>

            <Table
                dataSource={records}
                columns={columns}
                rowKey="id"
                loading={loading}
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
