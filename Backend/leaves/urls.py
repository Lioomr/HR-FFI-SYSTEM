from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    LeaveBalanceViewSet, 
    EmployeeLeaveBalanceView, 
    LeaveRequestViewSet, 
    LeaveTypeViewSet,
    ManagerLeaveRequestViewSet
)

router = DefaultRouter()
router.register(r'leave-types', LeaveTypeViewSet, basename='leave-types')
router.register(r'leave-requests', LeaveRequestViewSet, basename='leave-requests')
router.register(r'leave-balances', LeaveBalanceViewSet, basename='leave-balances')
router.register(r'manager/requests', ManagerLeaveRequestViewSet, basename='manager-leave-requests')

urlpatterns = [
    path('', include(router.urls)),
    path('employee/leave-balance/', EmployeeLeaveBalanceView.as_view(), name='employee-leave-balance'),
]
