from django.urls import path

from .views import ChangePasswordView, LoginView, LogoutView, UserMeView

urlpatterns = [
    path("login", LoginView.as_view()),
    path("change-password", ChangePasswordView.as_view()),
    path("logout", LogoutView.as_view()),
    path("me", UserMeView.as_view()),
]
