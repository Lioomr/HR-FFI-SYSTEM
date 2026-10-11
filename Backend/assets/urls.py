from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AssetDamageReportIntegrityViewSet,
    AssetReturnRequestIntegrityViewSet,
    AssetViewSet,
    CEOAssetDamageReportViewSet,
    CEOAssetReturnRequestViewSet,
    ManagerAssetReturnRequestViewSet,
)

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"assets", AssetViewSet, basename="assets")
router.register(
    r"assets/manager/return-requests", ManagerAssetReturnRequestViewSet, basename="manager-asset-return-requests"
)
router.register(r"ceo/assets/damage-reports", CEOAssetDamageReportViewSet, basename="ceo-asset-damage-reports")
router.register(r"ceo/assets/return-requests", CEOAssetReturnRequestViewSet, basename="ceo-asset-return-requests")
# Integrity actions only ({id}/integrity/, integrity/verify/, integrity/retry-seal/), beside the
# AssetViewSet PDF routes return-requests/{id}/pdf/ and damage-reports/{id}/pdf/.
router.register(
    r"assets/return-requests", AssetReturnRequestIntegrityViewSet, basename="asset-return-request-integrity"
)
router.register(r"assets/damage-reports", AssetDamageReportIntegrityViewSet, basename="asset-damage-report-integrity")

urlpatterns = [
    path("", include(router.urls)),
]
