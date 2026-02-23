from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

from .views import PayrollRunViewSet, EmployeePayslipViewSet, PayrollRunExportView

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"payroll-runs", PayrollRunViewSet, basename="payroll-runs")
router.register(r"employee/payslips", EmployeePayslipViewSet, basename="employee-payslips")

urlpatterns = router.urls

# Compatibility routes to ensure export endpoint resolves even if router action mapping
# is stale in a running process.
urlpatterns += [
    path("payroll-runs/<int:pk>/export/", PayrollRunExportView.as_view(), name="payroll-runs-export"),
    re_path(r"^payroll-runs/(?P<pk>\d+)/export$", PayrollRunExportView.as_view(), name="payroll-runs-export-no-slash"),
]
