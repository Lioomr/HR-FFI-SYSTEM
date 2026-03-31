from django.urls import path

from . import views

urlpatterns = [
    path("report-error/", views.ReportErrorAPIView.as_view(), name="report_error"),
    path("workflow/delegations/", views.DelegationRuleListCreateView.as_view(), name="delegation_rule_list_create"),
    path("workflow/delegations/<int:pk>/", views.DelegationRuleDetailView.as_view(), name="delegation_rule_detail"),
]
