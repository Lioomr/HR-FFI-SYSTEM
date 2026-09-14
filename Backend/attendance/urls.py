from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .biotime_views import (
    BioTimeActionsViewSet,
    BioTimeAgentEmployeesView,
    BioTimeAgentIngestView,
    BioTimeConfigViewSet,
    BioTimeEmployeeMapViewSet,
)
from .views import (
    AttendanceCorrectionRequestViewSet,
    AttendanceNoticeViewSet,
    AttendanceRecordViewSet,
    AttendanceViolationViewSet,
    CEOAttendanceViewSet,
    HRAttendanceRecalculateView,
    ManagerAttendanceViewSet,
    TodayAttendanceSummaryView,
    WorkLocationViewSet,
)

router = DefaultRouter()
# Must precede the attendance record routes: `attendance/{pk}/` would otherwise
# capture `attendance/violations/` or `attendance/notices/` as a record detail lookup.
router.register(r"attendance/violations", AttendanceViolationViewSet, basename="attendance-violations")
router.register(r"attendance/notices", AttendanceNoticeViewSet, basename="attendance-notices")
router.register(r"attendance", AttendanceRecordViewSet, basename="attendance")
router.register(
    r"attendance-correction-requests",
    AttendanceCorrectionRequestViewSet,
    basename="attendance-correction-requests",
)
router.register(r"manager/attendance", ManagerAttendanceViewSet, basename="manager-attendance")
router.register(r"ceo/attendance", CEOAttendanceViewSet, basename="ceo-attendance")
router.register(r"biotime-mappings", BioTimeEmployeeMapViewSet, basename="biotime-mappings")
router.register(r"work-locations", WorkLocationViewSet, basename="work-locations")

urlpatterns = [
    path("attendance/me/today-summary/", TodayAttendanceSummaryView.as_view(), name="attendance-today-summary"),
    path("attendance/hr/recalculate/", HRAttendanceRecalculateView.as_view(), name="attendance-hr-recalculate"),
    path("biotime/config/", BioTimeConfigViewSet.as_view(), name="biotime-config"),
    path("biotime/actions/<str:action>/", BioTimeActionsViewSet.as_view(), name="biotime-actions"),
    path("biotime/agent/ingest/", BioTimeAgentIngestView.as_view(), name="biotime-agent-ingest"),
    path("biotime/agent/employees/", BioTimeAgentEmployeesView.as_view(), name="biotime-agent-employees"),
    path("", include(router.urls)),
]
