from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AttendanceRecordViewSet, CEOAttendanceViewSet, ManagerAttendanceViewSet

from .biotime_views import BioTimeConfigViewSet, BioTimeActionsViewSet, BioTimeEmployeeMapViewSet

router = DefaultRouter()
router.register(r"attendance", AttendanceRecordViewSet, basename="attendance")
router.register(r"manager/attendance", ManagerAttendanceViewSet, basename="manager-attendance")
router.register(r"ceo/attendance", CEOAttendanceViewSet, basename="ceo-attendance")
router.register(r"biotime-mappings", BioTimeEmployeeMapViewSet, basename="biotime-mappings")

urlpatterns = [
    path("biotime/config/", BioTimeConfigViewSet.as_view(), name="biotime-config"),
    path("biotime/actions/<str:action>/", BioTimeActionsViewSet.as_view(), name="biotime-actions"),
    path("", include(router.urls)),
]
