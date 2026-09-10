import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Select, Space, Table, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import { getManagerAttendance } from "../../services/api/managerApi";
import type {
  AttendanceRecord,
  AttendanceStatus,
} from "../../types/attendance";
import { normalizeListData, unwrapEnvelope } from "../../utils/dataUtils";
import { formatDateOnly, formatTimeOnly12 } from "../../utils/dateTime";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerAttendancePage() {
  const { t, language } = useI18n();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<AttendanceStatus>();
  const [pagination, setPagination] = useState({ current: 1, pageSize: 25 });
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setRecords([]);
    try {
      // This endpoint owns mapped direct-report visibility; never use the HR list.
      const response = await getManagerAttendance({
        status,
        page: pagination.current,
        page_size: pagination.pageSize,
      });
      const data = normalizeListData<AttendanceRecord>(
        unwrapEnvelope(response),
      );
      setRecords(data.items);
      setTotal(data.total);
    } catch {
      setFailed(true);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [status, pagination]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div>
      <PageHeader
        title={t("attendance.managerTitle")}
        subtitle={t("attendance.biotimeNotice")}
        actions={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
            {t("common.refresh")}
          </Button>
        }
      />
      <Space style={{ marginBottom: 16 }}>
        <Select
          aria-label={t("common.status")}
          placeholder={t("common.status")}
          allowClear
          value={status}
          style={{ width: 180 }}
          onChange={(value) => {
            setStatus(value);
            setPagination((p) => ({ ...p, current: 1 }));
          }}
          options={["PRESENT", "ABSENT", "LATE"].map((value) => ({
            value,
            label: t(`attendancePreview.status.${value.toLowerCase()}`),
          }))}
        />
      </Space>
      {failed ? (
        <Alert type="error" title={t("attendancePreview.loadFailed")} />
      ) : (
        <Table<AttendanceRecord>
          rowKey="id"
          loading={loading}
          dataSource={records}
          scroll={{ x: "max-content" }}
          pagination={{
            ...pagination,
            total,
            onChange: (current, pageSize) =>
              setPagination({ current, pageSize }),
          }}
          columns={[
            {
              title: t("common.employee"),
              key: "employee",
              render: (_, record) =>
                (language === "ar"
                  ? record.employee_name_ar
                  : record.employee_name_en) ||
                record.employee_name ||
                record.employee_email ||
                "—",
            },
            {
              title: t("attendance.date"),
              dataIndex: "date",
              render: (value: string) => formatDateOnly(value),
            },
            {
              title: t("attendance.checkInTime"),
              dataIndex: "check_in_at",
              render: (value: string | null) => formatTimeOnly12(value),
            },
            {
              title: t("attendance.checkOutTime"),
              dataIndex: "check_out_at",
              render: (value: string | null) => formatTimeOnly12(value),
            },
            {
              title: t("common.status"),
              dataIndex: "status",
              render: (value: string) => (
                <Tag>
                  {t(`attendancePreview.status.${value.toLowerCase()}`, value)}
                </Tag>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
