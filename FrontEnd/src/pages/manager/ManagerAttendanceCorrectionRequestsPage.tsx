import PageHeader from "../../components/ui/PageHeader";
import ApprovalSurface from "../../components/ceo/ApprovalSurface";
import AttendanceMaintenanceBanner from "../../components/attendance/AttendanceMaintenanceBanner";
import AttendanceCorrectionsApproverTable from "../../components/attendance/AttendanceCorrectionsApproverTable";
import { useManagerAccess } from "../../hooks/useManagerAccess";
import { managedCountLabel } from "../../utils/managerCapability";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerAttendanceCorrectionRequestsPage() {
    const { t } = useI18n();
    const { access } = useManagerAccess();

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
            <PageHeader
                title={t("attendanceCorrections.page.managerTitle")}
                subtitle={t("attendanceCorrections.page.managerSubtitle")}
                secondarySubtitle={managedCountLabel(t, access.managed_employee_count)}
            />
            <AttendanceMaintenanceBanner
                description={t("attendanceCorrections.maintenance.managerDescription")}
            />
            <ApprovalSurface padding={16}>
                <AttendanceCorrectionsApproverTable
                    approverRole="manager"
                    defaultStatus="pending_manager"
                    statusOptions={["pending_manager", "pending_hr", "approved", "rejected", "cancelled"]}
                />
            </ApprovalSurface>
        </div>
    );
}
