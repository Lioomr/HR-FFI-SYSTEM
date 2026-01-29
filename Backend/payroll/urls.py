from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import PayrollRunViewSet, EmployeePayslipViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"payroll-runs", PayrollRunViewSet, basename="payroll-runs")
router.register(r"employee/payslips", EmployeePayslipViewSet, basename="employee-payslips")

urlpatterns = [
    path("", include(router.urls)),
]
