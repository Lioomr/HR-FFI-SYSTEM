from django.urls import path

from .views import (
    InviteAcceptView,
    InviteResendView,
    InviteRevokeView,
    InvitesListCreateView,
    InviteWhatsAppProviderTestView,
)

urlpatterns = [
    path("invites/", InvitesListCreateView.as_view()),
    path("invites/test-whatsapp/", InviteWhatsAppProviderTestView.as_view()),
    path("invites/<int:invite_id>/resend/", InviteResendView.as_view()),
    path("invites/<int:invite_id>/", InviteRevokeView.as_view()),
    path("invites/accept/", InviteAcceptView.as_view()),
]
