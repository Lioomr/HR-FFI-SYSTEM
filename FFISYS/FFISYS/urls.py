from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),

    path("api/accounts/", include("accounts.urls")),  # canonical
    path("api/auth/", include("accounts.urls")),      # backward compatible

    path("api/employees/", include("employees.urls")),
    path("api/departments/", include("organization.urls")),
    path("api/salaries/", include("payroll.urls")),
]
