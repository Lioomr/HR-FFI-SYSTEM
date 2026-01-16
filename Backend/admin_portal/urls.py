from django.urls import path
from .views_users import (
    UsersListCreateView, UserDetailView,
    UserStatusView, UserRoleView, UserResetPasswordView
)
from .views_dashboard import AdminSummaryView
from .views_settings import SettingsView

urlpatterns = [
    path("users", UsersListCreateView.as_view()),
    path("users/<int:user_id>", UserDetailView.as_view()),
    path("users/<int:user_id>/status", UserStatusView.as_view()),
    path("users/<int:user_id>/role", UserRoleView.as_view()),
    path("users/<int:user_id>/reset-password", UserResetPasswordView.as_view()),
    path("admin/summary", AdminSummaryView.as_view()),
     path("settings", SettingsView.as_view())
]
