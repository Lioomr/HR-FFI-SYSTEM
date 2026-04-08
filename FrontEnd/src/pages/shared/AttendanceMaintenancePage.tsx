import PageHeader from "../../components/ui/PageHeader";
import AttendanceMaintenanceNotice from "../../components/attendance/AttendanceMaintenanceNotice";
import { useI18n } from "../../i18n/useI18n";

export default function AttendanceMaintenancePage({
  title,
  subtitle,
  titleKey,
  subtitleKey,
  backPath,
}: {
  title?: string;
  subtitle?: string;
  titleKey?: string;
  subtitleKey?: string;
  backPath?: string;
}) {
  const { t } = useI18n();
  const resolvedTitle = title || (titleKey ? t(titleKey) : t("attendance.title", "Attendance"));
  const resolvedSubtitle =
    subtitle ||
    (subtitleKey
      ? t(subtitleKey)
      : t("attendance.maintenance.pageSubtitle", "This section is temporarily unavailable while we fix it."));

  return (
    <div>
      <PageHeader title={resolvedTitle} subtitle={resolvedSubtitle} />
      <AttendanceMaintenanceNotice backPath={backPath} />
    </div>
  );
}
