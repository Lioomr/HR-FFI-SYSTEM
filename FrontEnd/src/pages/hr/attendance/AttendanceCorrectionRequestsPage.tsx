import PageHeader from "../../../components/ui/PageHeader";
import AttendanceMaintenanceBanner from "../../../components/attendance/AttendanceMaintenanceBanner";
import AttendanceCorrectionsApproverTable from "../../../components/attendance/AttendanceCorrectionsApproverTable";
import { useI18n } from "../../../i18n/useI18n";

export default function HRAttendanceCorrectionRequestsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        title={t("attendanceCorrections.page.hrTitle", "Attendance Correction Requests")}
        subtitle={t(
          "attendanceCorrections.page.hrSubtitle",
          "Review and apply attendance corrections approved by managers."
        )}
      />
      <AttendanceMaintenanceBanner
        description={t(
          "attendanceCorrections.maintenance.hrDescription",
          "The attendance module is under maintenance. HR approvals here will still apply the change to the attendance record once it is back."
        )}
      />
      <AttendanceCorrectionsApproverTable
        approverRole="hr"
        defaultStatus="pending_hr"
        statusOptions={["pending_hr", "pending_manager", "approved", "rejected", "cancelled", "draft"]}
        successMessage={t("attendanceCorrections.success.applied", "Correction applied.")}
      />
    </div>
  );
}
