from rest_framework import serializers
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor_email",
            "action",
            "entity",
            "entity_id",
            "ip_address",
            "created_at",
            "metadata",
        ]

    def get_actor_email(self, obj):
        return obj.actor.email if obj.actor else None
