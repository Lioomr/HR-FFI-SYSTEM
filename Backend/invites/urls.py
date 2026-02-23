from django.urls import path
from .views import InvitesListCreateView, InviteResendView, InviteRevokeView, InviteAcceptView

urlpatterns = [
    path("invites/", InvitesListCreateView.as_view()),
    path("invites/<int:invite_id>/resend/", InviteResendView.as_view()),
    path("invites/<int:invite_id>/", InviteRevokeView.as_view()),
    path("invites/accept/", InviteAcceptView.as_view()),
]
