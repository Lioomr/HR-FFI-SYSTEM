from rest_framework import serializers

from .models import Department, Position, Sponsor, TaskGroup


class BaseReferenceSerializer(serializers.ModelSerializer):
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        fields = ["id", "code", "name", "description", "company_id", "company_name"]


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
        company = getattr(self.instance, "company", None)
        request = self.context.get("request")
        if request and hasattr(request, "_active_company") and request._active_company is not None:
            company = request._active_company
        qs = Sponsor.objects.filter(company=company, code=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Already exists")
        return value
