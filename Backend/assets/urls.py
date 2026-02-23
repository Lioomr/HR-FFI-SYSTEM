from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AssetViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"assets", AssetViewSet, basename="assets")

urlpatterns = [
    path("", include(router.urls)),
]
