import PageHeader from "../../components/ui/PageHeader";
import AttendanceMaintenanceBanner from "../../components/attendance/AttendanceMaintenanceBanner";
import AttendanceCorrectionsApproverTable from "../../components/attendance/AttendanceCorrectionsApproverTable";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerAttendanceCorrectionRequestsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        title={t("attendanceCorrections.page.managerTitle", "Attendance Corrections")}
        subtitle={t(
          "attendanceCorrections.page.managerSubtitle",
          "Review attendance correction requests submitted by your team."
        )}
      />
      <AttendanceMaintenanceBanner
        description={t(
          "attendanceCorrections.maintenance.managerDescription",
          "The attendance module is under maintenance. You can still approve correction requests here so the records are updated once it is back."
        )}
      />
      <AttendanceCorrectionsApproverTable
        approverRole="manager"
        defaultStatus="pending_manager"
        statusOptions={["pending_manager", "pending_hr", "approved", "rejected", "cancelled"]}
      />
    </div>
  );
}
