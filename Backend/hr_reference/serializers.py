from rest_framework import serializers

from .models import Department, Position, TaskGroup, Sponsor


class BaseReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        fields = ["id", "code", "name", "description"]


class DepartmentSerializer(BaseReferenceSerializer):
    class Meta(BaseReferenceSerializer.Meta):
        model = Department


class PositionSerializer(BaseReferenceSerializer):
    class Meta(BaseReferenceSerializer.Meta):
        model = Position


class TaskGroupSerializer(BaseReferenceSerializer):
    class Meta(BaseReferenceSerializer.Meta):
        model = TaskGroup


class SponsorSerializer(BaseReferenceSerializer):
    name = serializers.CharField(required=False, allow_blank=True)

    class Meta(BaseReferenceSerializer.Meta):
        model = Sponsor

    def validate_code(self, value: str):
        qs = Sponsor.objects.filter(code=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Already exists")
        return value
