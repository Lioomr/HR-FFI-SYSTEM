from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PenaltyCatalogView, PenaltyViewSet

router = DefaultRouter()
router.register("", PenaltyViewSet, basename="penalties")

urlpatterns = [path("catalog/", PenaltyCatalogView.as_view(), name="penalties-catalog"), *router.urls]
