from django.contrib import admin
from django.urls import path, include
from core.views import HrSummaryView

urlpatterns = [

    path("auth/", include("accounts.urls")),
    path("", include("admin_portal.urls")),
    path("", include("invites.urls")),
    path("", include("audit.urls")),
    path("", include("employees.urls")),
    path("hr/summary", HrSummaryView.as_view()),
    path("api/", include("employees.urls")),
    path("api/hr/", include("hr_reference.urls")),
    path("api/leaves/", include("leaves.urls")),
    path("api/", include("attendance.urls")),

    path("admin/", admin.site.urls),
]
