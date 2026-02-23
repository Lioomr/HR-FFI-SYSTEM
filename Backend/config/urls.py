from django.contrib import admin
from django.urls import include, path, re_path
from core.views import HrSummaryView
from payroll.views import PayrollRunExportView

urlpatterns = [
    path("auth/", include("accounts.urls")),
    path("", include("admin_portal.urls")),
    path("", include("invites.urls")),
    path("", include("audit.urls")),
    path("", include("employees.urls")),
    # Explicit payroll export route to avoid any include/router resolution edge cases.
    path("payroll-runs/<int:pk>/export/", PayrollRunExportView.as_view()),
    re_path(r"^payroll-runs/(?P<pk>\d+)/export$", PayrollRunExportView.as_view()),
    path("", include("payroll.urls")),
    path("api/", include("announcements.urls")),
    path("api/", include("employees.urls")),
    path("api/hr/summary/", HrSummaryView.as_view()),
    path("api/hr/", include("hr_reference.urls")),
    path("api/leaves/", include("leaves.urls")),
    path("api/", include("assets.urls")),
    path("api/loans/", include("loans.urls")),
    path("api/", include("attendance.urls")),
    path("admin/", admin.site.urls),
]
