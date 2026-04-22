from pathlib import Path

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from core.services import get_workflow_snapshot
from employees.models import EmployeeProfile

from .models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest, PrintedLabelJob

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
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

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
            "must_return_before_travel",
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
            "company_id",
            "company_name",
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        company = getattr(request, "_active_company", None) if request else None
        if company is not None:
            self.fields["employee_id"].queryset = EmployeeProfile.objects.filter(company=company)

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
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = AssetDamageReport
        fields = [
            "id",
            "asset",
            "asset_code",
            "asset_name",
            "company_id",
            "company_name",
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
    workflow = serializers.SerializerMethodField()
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = AssetReturnRequest
        fields = [
            "id",
            "asset",
            "asset_code",
            "asset_name",
            "company_id",
            "company_name",
            "employee",
            "employee_name",
            "employee_email",
            "requested_at",
            "note",
            "status",
            "processed_by",
            "processed_at",
            "manager_decision_by",
            "manager_decision_at",
            "manager_decision_note",
            "hr_decision_by",
            "hr_decision_at",
            "hr_decision_note",
            "ceo_decision_by",
            "ceo_decision_at",
            "ceo_decision_note",
            "workflow",
        ]

    def get_workflow(self, obj):
        actor = self.context.get("request").user if self.context.get("request") else None
        return get_workflow_snapshot(obj, actor=actor)


class AssetRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)


class PrintedLabelJobSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = PrintedLabelJob
        fields = [
            "id",
            "created_by_name",
            "created_at",
            "asset_count",
            "paper_size",
            "asset_codes",
            "pdf_url",
        ]

    def get_created_by_name(self, obj):
        user = obj.created_by
        if not user:
            return ""
        return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "")

    def get_pdf_url(self, obj):
        request = self.context.get("request")
        path = f"/api/assets/labels/jobs/{obj.id}/pdf/"
        return request.build_absolute_uri(path) if request else path


class AssetLabelsPrintSerializer(serializers.Serializer):
    asset_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        min_length=1,
        max_length=200,
        allow_empty=False,
    )
    paper_size = serializers.ChoiceField(choices=PrintedLabelJob.PaperSize.choices)

    def validate_asset_ids(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Duplicate asset ids are not allowed.")
        return value


class AssetLookupSerializer(serializers.Serializer):
    asset = serializers.SerializerMethodField()
    active_assignment = serializers.SerializerMethodField()
    recent_damage_reports = serializers.SerializerMethodField()
    recent_return_requests = serializers.SerializerMethodField()

    def get_asset(self, obj):
        return AssetSerializer(obj, context=self.context).data

    def get_active_assignment(self, obj):
        assignment = obj.assignments.filter(is_active=True).select_related(
            "employee",
            "employee__department_ref",
            "employee__position_ref",
            "assigned_by",
        ).first()
        if not assignment:
            return None
        employee = assignment.employee
        assigned_by = assignment.assigned_by
        return {
            "id": assignment.id,
            "employee": {
                "id": employee.id,
                "employee_id": employee.employee_id,
                "full_name": employee.full_name or employee.full_name_en or "",
                "department": employee.department_name_en
                or getattr(employee.department_ref, "name", "")
                or employee.department
                or "",
                "job_title": employee.job_title_en
                or getattr(employee.position_ref, "name", "")
                or employee.job_title
                or "",
            },
            "assigned_at": assignment.assigned_at,
            "assigned_by_name": str(getattr(assigned_by, "full_name", "") or getattr(assigned_by, "email", "") or ""),
        }

    def get_recent_damage_reports(self, obj):
        return [
            {
                "id": report.id,
                "description": report.description,
                "status": report.status,
                "reported_at": report.reported_at,
            }
            for report in obj.damage_reports.order_by("-reported_at")[:3]
        ]

    def get_recent_return_requests(self, obj):
        return [
            {
                "id": req.id,
                "status": req.status,
                "requested_at": req.requested_at,
                "note": req.note,
            }
            for req in obj.return_requests.order_by("-requested_at")[:3]
        ]
