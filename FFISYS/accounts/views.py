from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import IsAuthenticated

from .serializers import (
    CustomTokenObtainPairSerializer,
    AdminUserCreateSerializer,
)
from .models import User
from .permissions import IsAdminOrHR


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class AdminUserViewSet(ModelViewSet):
    queryset = User.objects.exclude(is_superuser=True).order_by("-date_joined")
    serializer_class = AdminUserCreateSerializer
    permission_classes = [IsAuthenticated, IsAdminOrHR]
