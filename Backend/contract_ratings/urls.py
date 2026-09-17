from rest_framework.routers import DefaultRouter

from .views import ContractRatingViewSet

router = DefaultRouter()
router.register("contract-ratings", ContractRatingViewSet, basename="contract-rating")
urlpatterns = router.urls
