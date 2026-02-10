from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import EmployeeProfileViewSet, EmployeeImportHistoryViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"employees", EmployeeProfileViewSet, basename="employees")
router.register(r"imports/employees/history", EmployeeImportHistoryViewSet, basename="employee-imports")

urlpatterns = [
    path("", include(router.urls)),
]
