from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AttendanceRecordViewSet, ManagerAttendanceViewSet

router = DefaultRouter()
router.register(r"attendance", AttendanceRecordViewSet, basename="attendance")
router.register(r"manager/attendance", ManagerAttendanceViewSet, basename="manager-attendance")

urlpatterns = [
    path("", include(router.urls)),
]
