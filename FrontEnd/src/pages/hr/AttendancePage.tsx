import React, { useEffect, useState } from "react";
import { Table, Button, Card, DatePicker, Row, Col, Typography, Tag, message, Input, Select } from "antd";
import { ReloadOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useHrAttendanceStore } from "../../stores/attendanceStore";
import type { AttendanceRecord, AttendanceStatus } from "../../types/attendance";
import AttendanceOverrideModal from "../../components/hr/AttendanceOverrideModal";

const { Title } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
        case "PRESENT": return "green";
        case "ABSENT": return "red";
        case "LATE": return "orange";
        default: return "default";
    }
};

const HrAttendancePage: React.FC = () => {
    const {
        records,
        total,
        loading,
        error,
        fetchGlobalRecords,
        performOverride
    } = useHrAttendanceStore();

    const [filters, setFilters] = useState<{
        dateRange: [dayjs.Dayjs, dayjs.Dayjs] | null;
        status: AttendanceStatus | undefined;
        employeeId: string;
    }>({
        dateRange: [dayjs().subtract(7, "day"), dayjs()],
        status: undefined,
        employeeId: "",
    });

    const [pagination, setPagination] = useState({
        current: 1,
        pageSize: 25,
    });

    const [modalVisible, setModalVisible] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);

    const fetchData = () => {
        const params: any = {
            page: pagination.current,
            page_size: pagination.pageSize,
        };

        if (filters.dateRange) {
            params.date_from = filters.dateRange[0].format("YYYY-MM-DD");
            params.date_to = filters.dateRange[1].format("YYYY-MM-DD");
        }
        if (filters.status) params.status = filters.status;
        if (filters.employeeId) params.employee_id = filters.employeeId;

        fetchGlobalRecords(params);
    };

    useEffect(() => {
        fetchData();
    }, [pagination]); // Trigger when pagination changes. Filters triggered manually via Search button? Or auto? Let's do Search button for EmployeeID, auto for others might be annoying. Or just auto for all + search button.

    // Let's rely on "Search" button for all filter application to avoid rapid refetches, or use a separate effect for filter changes if we want auto-update
    // User request says "Search button + Reset button". So we won't auto-fetch on filter change.

    useEffect(() => {
        if (error) {
            message.error(error);
        }
    }, [error]);

    const handleOverrideClick = (record: AttendanceRecord) => {
        setSelectedRecord(record);
        setModalVisible(true);
    };

    const handleOverrideSubmit = async (id: string | number, values: any) => {
        try {
            await performOverride(id, values);
            message.success("Attendance record updated");
            setModalVisible(false);
            fetchData(); // Refresh list
        } catch (_e) {
            // Error handled by store
        }
    };

    const columns = [
        {
            title: "Employee",
            key: "employee",
            render: (_: any, record: AttendanceRecord) => (
                <div>
                    <div>{record.employee_name || `ID: ${record.employee_profile}`}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{record.employee_email}</div>
                </div>
            )
        },
        {
            title: "Date",
            dataIndex: "date",
            key: "date",
            render: (val: string) => dayjs(val).format("YYYY-MM-DD"),
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
            render: (val: string | null) => val ? dayjs(val).format("HH:mm") : "-",
        },
        {
            title: "Check Out",
            dataIndex: "check_out_at",
            key: "check_out_at",
            render: (val: string | null) => val ? dayjs(val).format("HH:mm") : "-",
        },
        {
            title: "Src",
            dataIndex: "source",
            key: "source",
            render: (src: string) => <Tag>{src}</Tag>
        },
        {
            title: "Ovr",
            dataIndex: "is_overridden",
            key: "is_overridden",
            render: (isOvr: boolean) => isOvr ? <span style={{ color: "orange" }}>Yes</span> : "No"
        },
        {
            title: "Action",
            key: "action",
            render: (_: any, record: AttendanceRecord) => (
                <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleOverrideClick(record)}
                >
                    Override
                </Button>
            ),
        },
    ];

    return (
        <div>
            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Col>
                    <Title level={2}>Attendance Records</Title>
                </Col>
                <Col>
                    <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
                </Col>
            </Row>

            <Card style={{ marginBottom: 16 }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col span={6}>
                        <Input
                            placeholder="Employee ID"
                            value={filters.employeeId}
                            onChange={e => setFilters(prev => ({ ...prev, employeeId: e.target.value }))}
                        />
                    </Col>
                    <Col span={6}>
                        <Select
                            style={{ width: '100%' }}
                            placeholder="Status"
                            allowClear
                            value={filters.status}
                            onChange={val => setFilters(prev => ({ ...prev, status: val }))}
                        >
                            <Option value="PRESENT">PRESENT</Option>
                            <Option value="ABSENT">ABSENT</Option>
                            <Option value="LATE">LATE</Option>
                        </Select>
                    </Col>
                    <Col span={8}>
                        <RangePicker
                            style={{ width: '100%' }}
                            value={filters.dateRange}
                            onChange={dates => {
                                if (dates && dates[0] && dates[1]) {
                                    setFilters(prev => ({ ...prev, dateRange: [dates[0]!, dates[1]!] }));
                                } else {
                                    setFilters(prev => ({ ...prev, dateRange: null }));
                                }
                            }}
                        />
                    </Col>
                    <Col span={4}>
                        <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPagination(p => ({ ...p, current: 1 })); fetchData(); }}>
                            Search
                        </Button>
                        <Button
                            style={{ marginLeft: 8 }}
                            onClick={() => {
                                setFilters({
                                    dateRange: null,
                                    status: undefined,
                                    employeeId: ""
                                });
                                setPagination(p => ({ ...p, current: 1 }));
                                // We might want to trigger fetch here after state update, but react state is async. 
                                // Simplified:
                                setTimeout(fetchData, 0);
                            }}
                        >
                            Reset
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

            <AttendanceOverrideModal
                visible={modalVisible}
                record={selectedRecord}
                loading={loading}
                onCancel={() => setModalVisible(false)}
                onSubmit={handleOverrideSubmit}
            />
        </div>
    );
};

export default HrAttendancePage;
