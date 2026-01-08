from rest_framework.viewsets import ReadOnlyModelViewSet
from rest_framework.permissions import IsAuthenticated
from rest_framework.serializers import ModelSerializer
from .models import AuditLog


class AuditLogSerializer(ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"


class AuditLogViewSet(ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor", "target_user")
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
