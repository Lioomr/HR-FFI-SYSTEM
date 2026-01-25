from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import EmployeeProfileViewSet

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r'employees', EmployeeProfileViewSet, basename='employees')

urlpatterns = [
    path('', include(router.urls)),
]
