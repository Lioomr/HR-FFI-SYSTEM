import React, { useEffect, useState } from "react";
import { Table, Button, Card, DatePicker, Row, Col, Typography, Tag, message, Input, Select, Space } from "antd";
import { ReloadOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useHrAttendanceStore } from "../../stores/attendanceStore";
import type { AttendanceRecord, AttendanceStatus } from "../../types/attendance";
import AttendanceOverrideModal from "../../components/hr/AttendanceOverrideModal";
import { useI18n } from "../../i18n/useI18n";

const { Title } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
        case "PRESENT": return "green";
        case "ABSENT": return "red";
        case "LATE": return "orange";
        case "REJECTED": return "magenta";
        default: return "default";
    }
};

const HrAttendancePage: React.FC = () => {
    const { t } = useI18n();
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
    }, [pagination]);

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
            message.success(t("hr.attendance.recordUpdated"));
            setModalVisible(false);
            fetchData(); // Refresh list
        } catch (_e) {
            // Error handled by store
        }
    };

    const columns = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_: any, record: AttendanceRecord) => (
                <div>
                    <div>{record.employee_name || `ID: ${record.employee_profile}`}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{record.employee_email}</div>
                </div>
            )
        },
        {
            title: t("common.date"),
            dataIndex: "date",
            key: "date",
            render: (val: string) => dayjs(val).format("YYYY-MM-DD"),
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            render: (status: AttendanceStatus) => {
                let displayStatus = status;
                switch (status) {
                    case "PENDING": displayStatus = t("status.pending") as any; break;
                    case "PRESENT": displayStatus = t("status.active") as any; break;
                    case "ABSENT": displayStatus = t("status.absent") as any; break;
                    case "LATE": displayStatus = t("hr.attendance.late") as any; break;
                    case "REJECTED": displayStatus = t("status.rejected") as any; break;
                }
                return <Tag color={getStatusColor(status)}>{displayStatus}</Tag>;
            },
        },
        {
            title: t("attendance.checkIn"),
            dataIndex: "check_in_at",
            key: "check_in_at",
            render: (val: string | null) => val ? dayjs(val).format("HH:mm") : "-",
        },
        {
            title: t("attendance.checkOut"),
            dataIndex: "check_out_at",
            key: "check_out_at",
            render: (val: string | null) => val ? dayjs(val).format("HH:mm") : "-",
        },
        {
            title: t("hr.attendance.source"),
            dataIndex: "source",
            key: "source",
            render: (src: string) => <Tag>{src}</Tag>
        },
        {
            title: t("hr.attendance.isOverridden"),
            dataIndex: "is_overridden",
            key: "is_overridden",
            render: (isOvr: boolean) => isOvr ? <span style={{ color: "orange" }}>{t("common.yes")}</span> : t("common.no")
        },
        {
            title: t("common.actions"),
            key: "action",
            render: (_: any, record: AttendanceRecord) => (
                <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleOverrideClick(record)}
                >
                    {t("hr.attendance.overrideButton")}
                </Button>
            ),
        },
    ];

    return (
        <div style={{ padding: 24 }}>
            <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
                <Col>
                    <Title level={2} style={{ margin: 0 }}>{t("hr.attendance.recordsTitle")}</Title>
                </Col>
                <Col>
                    <Button icon={<ReloadOutlined />} onClick={fetchData} size="large">{t("common.refresh")}</Button>
                </Col>
            </Row>

            <Card style={{ marginBottom: 24, borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col xs={24} md={6}>
                        <Input
                            placeholder={t("hr.attendance.employeeIdPlaceholder")}
                            value={filters.employeeId}
                            onChange={e => setFilters(prev => ({ ...prev, employeeId: e.target.value }))}
                            size="large"
                        />
                    </Col>
                    <Col xs={24} md={6}>
                        <Select
                            style={{ width: '100%' }}
                            placeholder={t("hr.attendance.selectStatusPlaceholder")}
                            allowClear
                            value={filters.status}
                            onChange={val => setFilters(prev => ({ ...prev, status: val }))}
                            size="large"
                        >
                            <Option value="PRESENT">{t("status.active")}</Option>
                            <Option value="ABSENT">{t("status.absent")}</Option>
                            <Option value="LATE">{t("hr.attendance.late")}</Option>
                        </Select>
                    </Col>
                    <Col xs={24} md={8}>
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
                            size="large"
                        />
                    </Col>
                    <Col xs={24} md={4}>
                        <Space>
                            <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPagination(p => ({ ...p, current: 1 })); fetchData(); }} size="large">
                                {t("common.search")}
                            </Button>
                            <Button
                                onClick={() => {
                                    setFilters({
                                        dateRange: null,
                                        status: undefined,
                                        employeeId: ""
                                    });
                                    setPagination(p => ({ ...p, current: 1 }));
                                    setTimeout(fetchData, 0);
                                }}
                                size="large"
                            >
                                {t("common.reset")}
                            </Button>
                        </Space>
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
                style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
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
