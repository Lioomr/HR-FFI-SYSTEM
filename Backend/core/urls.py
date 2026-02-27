from django.urls import path

from . import views

urlpatterns = [
    path("report-error/", views.ReportErrorAPIView.as_view(), name="report_error"),
]
