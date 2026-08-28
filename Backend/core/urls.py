from django.urls import path

from . import views
from .views_templates import TemplateDownloadView, TemplateListView
from .views_whatsapp_templates import (
    WhatsAppTemplateDetailView,
    WhatsAppTemplateListView,
    WhatsAppTemplatePreviewView,
    WhatsAppTemplateResetView,
    WhatsAppTemplateTestView,
)

urlpatterns = [
    path("report-error/", views.ReportErrorAPIView.as_view(), name="report_error"),
    path("pending-requests/", views.PendingRequestsView.as_view(), name="pending_requests"),
    path("workflow/delegations/", views.DelegationRuleListCreateView.as_view(), name="delegation_rule_list_create"),
    path("workflow/delegations/<int:pk>/", views.DelegationRuleDetailView.as_view(), name="delegation_rule_detail"),
    path("organization-scopes/", views.OrganizationScopeListCreateView.as_view(), name="organization_scope_list_create"),
    path("organization-scopes/<int:pk>/", views.OrganizationScopeDetailView.as_view(), name="organization_scope_detail"),
    path(
        "cross-company-manager-assignments/",
        views.CrossCompanyManagerAssignmentListCreateView.as_view(),
        name="cross_company_manager_assignment_list_create",
    ),
    path(
        "cross-company-manager-assignments/<int:pk>/",
        views.CrossCompanyManagerAssignmentDetailView.as_view(),
        name="cross_company_manager_assignment_detail",
    ),
    path("request-obligations/", views.RequestObligationListView.as_view(), name="request_obligation_list"),
    path(
        "request-obligations/<int:pk>/waive/",
        views.RequestObligationWaiveView.as_view(),
        name="request_obligation_waive",
    ),
    path("preferences/<str:scope>/<str:key>/", views.UserPreferenceDetailView.as_view(), name="user_preference_detail"),
    path("templates/", TemplateListView.as_view(), name="template_list"),
    path("templates/<str:key>/download/", TemplateDownloadView.as_view(), name="template_download"),
    path("whatsapp-templates/", WhatsAppTemplateListView.as_view(), name="whatsapp_template_list"),
    path("whatsapp-templates/<str:key>/", WhatsAppTemplateDetailView.as_view(), name="whatsapp_template_detail"),
    path("whatsapp-templates/<str:key>/reset/", WhatsAppTemplateResetView.as_view(), name="whatsapp_template_reset"),
    path(
        "whatsapp-templates/<str:key>/preview/", WhatsAppTemplatePreviewView.as_view(), name="whatsapp_template_preview"
    ),
    path("whatsapp-templates/<str:key>/test/", WhatsAppTemplateTestView.as_view(), name="whatsapp_template_test"),
]
