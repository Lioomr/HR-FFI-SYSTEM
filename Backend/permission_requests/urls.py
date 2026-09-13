from rest_framework.routers import SimpleRouter

from .views import PermissionRequestViewSet

router = SimpleRouter()
router.trailing_slash = "/?"
router.register(r"permission-requests", PermissionRequestViewSet, basename="permission-requests")

urlpatterns = router.urls
