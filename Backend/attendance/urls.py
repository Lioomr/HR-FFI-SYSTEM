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
    AttendanceRecordViewSet,
    CEOAttendanceViewSet,
    ManagerAttendanceViewSet,
)

router = DefaultRouter()
router.register(r"attendance", AttendanceRecordViewSet, basename="attendance")
router.register(
    r"attendance-correction-requests",
    AttendanceCorrectionRequestViewSet,
    basename="attendance-correction-requests",
)
router.register(r"manager/attendance", ManagerAttendanceViewSet, basename="manager-attendance")
router.register(r"ceo/attendance", CEOAttendanceViewSet, basename="ceo-attendance")
router.register(r"biotime-mappings", BioTimeEmployeeMapViewSet, basename="biotime-mappings")

urlpatterns = [
    path("biotime/config/", BioTimeConfigViewSet.as_view(), name="biotime-config"),
    path("biotime/actions/<str:action>/", BioTimeActionsViewSet.as_view(), name="biotime-actions"),
    path("biotime/agent/ingest/", BioTimeAgentIngestView.as_view(), name="biotime-agent-ingest"),
    path("biotime/agent/employees/", BioTimeAgentEmployeesView.as_view(), name="biotime-agent-employees"),
    path("", include(router.urls)),
]
