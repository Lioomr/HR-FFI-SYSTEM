from rest_framework.routers import DefaultRouter

from .views import AnnouncementViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"announcements", AnnouncementViewSet, basename="announcements")

urlpatterns = router.urls
