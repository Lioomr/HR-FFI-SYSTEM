from django.urls import path

from . import views
from .views_templates import TemplateDownloadView, TemplateListView

urlpatterns = [
    path("report-error/", views.ReportErrorAPIView.as_view(), name="report_error"),
    path("pending-requests/", views.PendingRequestsView.as_view(), name="pending_requests"),
    path("workflow/delegations/", views.DelegationRuleListCreateView.as_view(), name="delegation_rule_list_create"),
    path("workflow/delegations/<int:pk>/", views.DelegationRuleDetailView.as_view(), name="delegation_rule_detail"),
    path("request-obligations/", views.RequestObligationListView.as_view(), name="request_obligation_list"),
    path("request-obligations/<int:pk>/waive/", views.RequestObligationWaiveView.as_view(), name="request_obligation_waive"),
    path("preferences/<str:scope>/<str:key>/", views.UserPreferenceDetailView.as_view(), name="user_preference_detail"),
    path("templates/", TemplateListView.as_view(), name="template_list"),
    path("templates/<str:key>/download/", TemplateDownloadView.as_view(), name="template_download"),
]
