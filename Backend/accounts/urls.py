from django.urls import path

from .views import (
    ChangePasswordView,
    LoginView,
    LogoutView,
    PasswordResetConfirmView,
    PasswordResetOTPConfirmView,
    PasswordResetOTPVerifyView,
    PasswordResetOTPRequestView,
    TokenRefreshView,
    UserMeView,
)

urlpatterns = [
    path("login", LoginView.as_view()),
    path("refresh", TokenRefreshView.as_view()),
    path("change-password", ChangePasswordView.as_view()),
    path("reset-password/confirm", PasswordResetConfirmView.as_view()),
    path("password-reset/request", PasswordResetOTPRequestView.as_view()),
    path("password-reset/verify", PasswordResetOTPVerifyView.as_view()),
    path("password-reset/confirm", PasswordResetOTPConfirmView.as_view()),
    path("logout", LogoutView.as_view()),
    path("me", UserMeView.as_view()),
]
