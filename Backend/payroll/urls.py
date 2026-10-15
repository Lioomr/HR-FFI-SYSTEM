from django.urls import path, re_path
from rest_framework.routers import DefaultRouter

from .api import AccommodationViewSet, PayrollSettingsViewSet
from .views import EmployeePayslipViewSet, PayrollRunExportView, PayrollRunViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"payroll-runs", PayrollRunViewSet, basename="payroll-runs")
router.register(r"employee/payslips", EmployeePayslipViewSet, basename="employee-payslips")
router.register(r"payroll-settings", PayrollSettingsViewSet, basename="payroll-settings")
router.register(
    r"payroll-accommodation-assignments", AccommodationViewSet, basename="payroll-accommodation-assignments"
)

urlpatterns = [
    re_path(
        r"^payroll-settings/?$",
        PayrollSettingsViewSet.as_view({"get": "list", "patch": "patch"}),
        name="payroll-settings-config",
    ),
] + router.urls

# Compatibility routes to ensure export endpoint resolves even if router action mapping
# is stale in a running process.
urlpatterns += [
    path("payroll-runs/<int:pk>/export/", PayrollRunExportView.as_view(), name="payroll-runs-export"),
    re_path(r"^payroll-runs/(?P<pk>\d+)/export$", PayrollRunExportView.as_view(), name="payroll-runs-export-no-slash"),
]
