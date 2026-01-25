from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DepartmentViewSet, PositionViewSet, TaskGroupViewSet, SponsorViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"departments", DepartmentViewSet, basename="departments")
router.register(r"positions", PositionViewSet, basename="positions")
router.register(r"task-groups", TaskGroupViewSet, basename="task-groups")
router.register(r"sponsors", SponsorViewSet, basename="sponsors")

urlpatterns = [
    path("", include(router.urls)),
]
