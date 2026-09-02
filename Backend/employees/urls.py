from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ContractDecisionViewSet,
    EmployeeDeletionRequestViewSet,
    EmployeeImportHistoryViewSet,
    EmployeeProfileViewSet,
)

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"employees/deletion-requests", EmployeeDeletionRequestViewSet, basename="employee-deletion-requests")
router.register(r"employees/contract-decisions", ContractDecisionViewSet, basename="employee-contract-decisions")
router.register(r"imports/employees/history", EmployeeImportHistoryViewSet, basename="employee-imports")
router.register(r"employees", EmployeeProfileViewSet, basename="employees")

urlpatterns = [
    path("", include(router.urls)),
]
