from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    LeaveBalanceViewSet,
    EmployeeLeaveBalanceView,
    LeaveRequestViewSet,
    LeaveTypeViewSet,
    ManagerLeaveRequestViewSet,
    EmployeeLeaveRequestViewSet,
    LeaveBalanceAdjustmentViewSet,
)

router = DefaultRouter()
router.register(r"leave-types", LeaveTypeViewSet, basename="leave-types")
router.register(r"leave-balances", LeaveBalanceViewSet, basename="leave-balances")
router.register(r"leave-requests", LeaveRequestViewSet, basename="leave-requests")
router.register(r"employee/leave-requests", EmployeeLeaveRequestViewSet, basename="employee-leave-requests")
router.register(r"manager/leave-requests", ManagerLeaveRequestViewSet, basename="manager-leave-requests")
router.register(r"adjustments", LeaveBalanceAdjustmentViewSet, basename="leave-adjustments")

urlpatterns = [
    path("", include(router.urls)),
    path("employee/leave-balance/", EmployeeLeaveBalanceView.as_view(), name="employee-leave-balance"),
    path(
        "employee/leave-requests/", EmployeeLeaveRequestViewSet.as_view({"get": "list"}), name="employee-leave-requests"
    ),
]
