from django.urls import path
from .views import LoginView, ChangePasswordView, LogoutView

urlpatterns = [
    path("login", LoginView.as_view()),
    path("change-password", ChangePasswordView.as_view()),
    path("logout", LogoutView.as_view()),
]
