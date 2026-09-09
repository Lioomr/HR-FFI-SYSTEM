import React, { useCallback, useEffect, useMemo } from "react";
import {
  Table,
  Button,
  Card,
  DatePicker,
  Row,
  Col,
  Typography,
  Space,
  Tag,
  message,
  Alert,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEmployeeAttendanceStore } from "../../stores/attendanceStore";
import type {
  AttendanceRecord,
  AttendanceStatus,
} from "../../types/attendance";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatTimeOnly12 } from "../../utils/dateTime";

const { Title } = Typography;
const { RangePicker } = DatePicker;

// Status colors
const getStatusColor = (status: AttendanceStatus) => {
  switch (status) {
    case "PRESENT":
      return "green";
    case "ABSENT":
      return "red";
    case "LATE":
      return "orange";
    case "PENDING":
    case "PENDING_HR":
    case "PENDING_MGR":
    case "PENDING_CEO":
      return "gold";
    case "REJECTED":
      return "magenta";
    default:
      return "default";
  }
};

const EmployeeAttendancePage: React.FC = () => {
  const { t } = useI18n();
  const { records, total, loading, error, fetchMyRecords, accessUnavailable } =
    useEmployeeAttendanceStore();

  const [dateRange, setDateRange] = React.useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, "day"),
    dayjs(),
  ]);

  const [pagination, setPagination] = React.useState({
    current: 1,
    pageSize: 25,
  });

  const currentFilters = useMemo(
    () => ({
      date_from: dateRange[0].format("YYYY-MM-DD"),
      date_to: dateRange[1].format("YYYY-MM-DD"),
      page: pagination.current,
      page_size: pagination.pageSize,
    }),
    [dateRange, pagination],
  );

  const fetchData = useCallback(() => {
    fetchMyRecords(currentFilters);
  }, [fetchMyRecords, currentFilters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (error) {
      message.error(error);
    }
  }, [error]);

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
      width: 160,
      render: (status: AttendanceStatus, record: AttendanceRecord) => (
        <Space size={4} wrap>
          <Tag color={getStatusColor(status)} style={{ marginInlineEnd: 0 }}>
            {status}
          </Tag>
          {/* `is_late_flagged` is the stable "was late" signal for a row still
              awaiting approval, where `status` only says PENDING_*. */}
          {record.is_late_flagged && status.startsWith("PENDING") ? (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              {t("attendancePreview.lateArrivalTag")}
            </Tag>
          ) : null}
        </Space>
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
      title: t("attendancePreview.columns.lateBy"),
      dataIndex: "late_minutes",
      key: "late_minutes",
      width: 100,
      responsive: ["sm" as const],
      render: (val: number | undefined) =>
        val && val > 0 ? (
          <span style={{ color: "#f59e0b", fontWeight: 600 }}>+{val}m</span>
        ) : (
          "—"
        ),
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
      <Row
        justify="space-between"
        align="middle"
        gutter={[12, 12]}
        style={{ marginBottom: 16 }}
      >
        <Col xs={24} md="auto">
          <Title level={2} style={{ margin: 0 }}>
            {t("attendance.myAttendance")}
          </Title>
        </Col>
        <Col xs={24} md="auto">
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            {t("common.refresh")}
          </Button>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        title={t("attendance.biotimeNotice")}
        style={{ marginBottom: 16 }}
      />
      {accessUnavailable ? (
        <Alert type="info" showIcon title={t("attendance.unmapped")} />
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Row justify="space-between" align="middle" gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <RangePicker
                  style={{ width: "100%" }}
                  value={dateRange}
                  onChange={(dates) => {
                    if (dates && dates[0] && dates[1]) {
                      setDateRange([dates[0], dates[1]]);
                      setPagination((current) => ({ ...current, current: 1 }));
                    }
                  }}
                />
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
              onChange: (page, pageSize) =>
                setPagination({ current: page, pageSize }),
            }}
          />
        </>
      )}
    </div>
  );
};

export default EmployeeAttendancePage;
