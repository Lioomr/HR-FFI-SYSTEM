from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AssetViewSet, CEOAssetDamageReportViewSet, CEOAssetReturnRequestViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"assets", AssetViewSet, basename="assets")
router.register(r"ceo/assets/damage-reports", CEOAssetDamageReportViewSet, basename="ceo-asset-damage-reports")
router.register(r"ceo/assets/return-requests", CEOAssetReturnRequestViewSet, basename="ceo-asset-return-requests")

urlpatterns = [
    path("", include(router.urls)),
]
