from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AttendanceRecordViewSet, CEOAttendanceViewSet, ManagerAttendanceViewSet

router = DefaultRouter()
router.register(r"attendance", AttendanceRecordViewSet, basename="attendance")
router.register(r"manager/attendance", ManagerAttendanceViewSet, basename="manager-attendance")
router.register(r"ceo/attendance", CEOAttendanceViewSet, basename="ceo-attendance")

urlpatterns = [
    path("", include(router.urls)),
]
