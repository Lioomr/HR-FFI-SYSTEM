from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import RentTypeViewSet, RentViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"rent-types", RentTypeViewSet, basename="rent-types")
router.register(r"rents", RentViewSet, basename="rents")

urlpatterns = [path("", include(router.urls))]
