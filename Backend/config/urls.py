from django.contrib import admin
from django.urls import path, include

urlpatterns = [

    path("auth/", include("accounts.urls")),
    path("", include("admin_portal.urls")),
    path("", include("invites.urls")),
    path("", include("audit.urls")),

    path("admin/", admin.site.urls),
]
