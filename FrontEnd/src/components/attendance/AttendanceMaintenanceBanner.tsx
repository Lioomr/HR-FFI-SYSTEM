import { Alert } from "antd";
import { ToolOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";

export default function AttendanceMaintenanceBanner({
  description,
}: {
  description?: string;
}) {
  const { t } = useI18n();
  return (
    <Alert
      type="warning"
      showIcon
      icon={<ToolOutlined />}
      message={t("attendanceCorrections.maintenance.title", "Attendance is under maintenance")}
      description={
        description ||
        t(
          "attendanceCorrections.maintenance.description",
          "Attendance records are temporarily under maintenance. You can still submit correction requests for missing or incorrect records."
        )
      }
      style={{ borderRadius: 12, marginBottom: 16 }}
    />
  );
}
