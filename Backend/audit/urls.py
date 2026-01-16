from django.urls import path
from .views import AuditLogsListView, AuditLogsExportView

urlpatterns = [
    path("audit-logs", AuditLogsListView.as_view()),
    path("audit-logs/export", AuditLogsExportView.as_view()),
]
