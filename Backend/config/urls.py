from django.contrib import admin
from django.urls import path, include

urlpatterns = [

    path("auth/", include("accounts.urls")),
    path("", include("admin_portal.urls")),
    path("", include("invites.urls")),
    path("", include("audit.urls")),
    path("api/", include("employees.urls")),
    path("api/leaves/", include("leaves.urls")),
    path("api/", include("attendance.urls")),

    path("admin/", admin.site.urls),
]
