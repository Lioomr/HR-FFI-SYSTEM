from pathlib import Path

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from employees.models import EmployeeProfile

from .models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest

ASSET_INVOICE_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
ASSET_INVOICE_MAX_UPLOAD_SIZE = int(getattr(settings, "MAX_ASSET_INVOICE_SIZE_BYTES", 5 * 1024 * 1024))


class AssetAssignmentSummarySerializer(serializers.ModelSerializer):
    employee_id = serializers.CharField(source="employee.employee_id", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = AssetAssignment
        fields = [
            "id",
            "employee",
            "employee_id",
            "employee_name",
            "assigned_by",
            "assigned_at",
            "is_active",
        ]


class AssetSerializer(serializers.ModelSerializer):
    active_assignment = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Asset
        fields = [
            "id",
            "asset_code",
            "name_en",
            "name_ar",
            "type",
            "status",
            "serial_number",
            "purchase_date",
            "warranty_expiry",
            "asset_value",
            "vendor",
            "invoice_file",
            "notes",
            "flexible_attributes",
            "plate_number",
            "chassis_number",
            "engine_number",
            "fuel_type",
            "insurance_expiry",
            "registration_expiry",
            "cpu",
            "ram",
            "storage",
            "mac_address",
            "operating_system",
            "active_assignment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "asset_code", "created_at", "updated_at", "active_assignment"]

    def get_active_assignment(self, obj):
        assignment = obj.assignments.filter(is_active=True).select_related("employee").first()
        if not assignment:
            return None
        return AssetAssignmentSummarySerializer(assignment).data

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        asset_type = attrs.get("type", instance.type if instance else None)
        flexible_attributes = attrs.get(
            "flexible_attributes",
            instance.flexible_attributes if instance else None,
        )

        def get_value(field_name):
            if field_name in attrs:
                return attrs.get(field_name)
            return getattr(instance, field_name, None) if instance else None

        errors = {}
        if asset_type == Asset.AssetType.VEHICLE:
            for field_name in ["plate_number", "chassis_number", "engine_number", "fuel_type"]:
                if not get_value(field_name):
                    errors[field_name] = "This field is required for vehicle assets."

        if asset_type == Asset.AssetType.LAPTOP:
            for field_name in ["cpu", "ram", "storage", "mac_address", "operating_system"]:
                if not get_value(field_name):
                    errors[field_name] = "This field is required for laptop assets."

        if asset_type == Asset.AssetType.OTHER and not flexible_attributes:
            errors["flexible_attributes"] = "This field is required for OTHER assets."

        if errors:
            raise serializers.ValidationError(errors)

        return attrs

    def validate_invoice_file(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension not in ASSET_INVOICE_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError("Unsupported file type.")
        if value.size > ASSET_INVOICE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value


class AssetAssignmentCreateSerializer(serializers.Serializer):
    employee_id = serializers.PrimaryKeyRelatedField(queryset=EmployeeProfile.objects.all(), source="employee")

    def validate_employee(self, value):
        if value.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
            raise serializers.ValidationError("Only active employees can be assigned assets.")
        return value


class AssetReturnSerializer(serializers.Serializer):
    returned_at = serializers.DateTimeField(required=False)
    return_note = serializers.CharField(required=False, allow_blank=True)
    condition_on_return = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        attrs.setdefault("returned_at", timezone.now())
        return attrs


class AssetDamageReportCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetDamageReport
        fields = ["description"]

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("Description is required.")
        return value


class AssetDamageReportSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee.user.email", read_only=True)
    asset_code = serializers.CharField(source="asset.asset_code", read_only=True)
    asset_name = serializers.CharField(source="asset.name_en", read_only=True)

    class Meta:
        model = AssetDamageReport
        fields = [
            "id",
            "asset",
            "asset_code",
            "asset_name",
            "employee",
            "employee_name",
            "employee_email",
            "description",
            "status",
            "reported_at",
            "hr_decision_by",
            "hr_decision_at",
            "hr_decision_note",
            "ceo_decision_by",
            "ceo_decision_at",
            "ceo_decision_note",
        ]


class AssetReturnRequestCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetReturnRequest
        fields = ["note"]

    def validate_note(self, value):
        if not value.strip():
            raise serializers.ValidationError("Note is required.")
        return value


class AssetReturnRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee.user.email", read_only=True)
    asset_code = serializers.CharField(source="asset.asset_code", read_only=True)
    asset_name = serializers.CharField(source="asset.name_en", read_only=True)

    class Meta:
        model = AssetReturnRequest
        fields = [
            "id",
            "asset",
            "asset_code",
            "asset_name",
            "employee",
            "employee_name",
            "employee_email",
            "requested_at",
            "note",
            "status",
            "processed_by",
            "processed_at",
            "hr_decision_by",
            "hr_decision_at",
            "hr_decision_note",
            "ceo_decision_by",
            "ceo_decision_at",
            "ceo_decision_note",
        ]


class AssetRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
