from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import CustomTokenObtainPairView, AdminUserViewSet
from .password_views import ChangePasswordView

router = DefaultRouter()
router.register(r"admin/users", AdminUserViewSet, basename="admin-users")

urlpatterns = [
    path("auth/login/", CustomTokenObtainPairView.as_view(), name="login"),
    path("admin/auth/change-password/", ChangePasswordView.as_view()),
    path("", include(router.urls)),
]
