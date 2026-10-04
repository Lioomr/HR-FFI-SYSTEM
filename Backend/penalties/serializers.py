from rest_framework import serializers

from accounts.permissions import get_role

from .models import PenaltyCatalog, PenaltyRecord
from .services import AUTO_WARNING_ROWS, EXTRA_AUTO_WARNINGS, auto_warnings_effective_from

#: Resolution keys an employee may see on an automatic warning; review proposals
#: and failure counters can reveal recurrence and stay HR-only.
EMPLOYEE_AUTOMATION_RESOLUTION_KEYS = ("decision", "reason", "note", "resolved_at", "reopened_at")


class PenaltyCatalogSerializer(serializers.ModelSerializer):
    # Extra automatic warnings precede the printed levels (company policy, not the schedule).
    auto_warning_extra_levels = serializers.SerializerMethodField()

    def get_auto_warning_extra_levels(self, obj):
        return EXTRA_AUTO_WARNINGS if obj.code in AUTO_WARNING_ROWS and auto_warnings_effective_from() else 0

    class Meta:
        model = PenaltyCatalog
        fields = [
            "code",
            "category",
            "title_en",
            "title_ar",
            "description_en",
            "description_ar",
            "count_period",
            "levels",
            "source_page",
            "source_row",
            "automatic",
            "extra_wage_deduction",
            "auto_warning_extra_levels",
        ]


class PenaltyRecordSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(read_only=True)
    employee_profile_id = serializers.IntegerField(read_only=True)
    employee_name_en = serializers.CharField(source="employee_profile.full_name_en", read_only=True)
    employee_name_ar = serializers.CharField(source="employee_profile.full_name_ar", read_only=True)
    catalog_code = serializers.CharField(source="catalog.code", read_only=True)
    category = serializers.CharField(source="catalog.category", read_only=True)
    count_period = serializers.CharField(source="catalog.count_period", read_only=True)
    description = serializers.CharField(source="catalog.description_en", read_only=True)
    description_en = serializers.CharField(source="catalog.description_en", read_only=True)
    description_ar = serializers.CharField(source="catalog.description_ar", read_only=True)
    attendance_result_id = serializers.IntegerField(read_only=True)
    attendance_record_id = serializers.IntegerField(read_only=True)
    dispute_reason = serializers.SerializerMethodField()
    payroll_status = serializers.SerializerMethodField()
    source_page = serializers.IntegerField(source="catalog.source_page", read_only=True)
    source_row = serializers.IntegerField(source="catalog.source_row", read_only=True)
    warning_notice = serializers.SerializerMethodField()

    class Meta:
        model = PenaltyRecord
        fields = [
            "id",
            "company_id",
            "employee_profile_id",
            "employee_name_en",
            "employee_name_ar",
            "catalog_code",
            "category",
            "occurred_on",
            "occurrence_number",
            "count_period",
            "action",
            "amount",
            "extra_wage_amount",
            "total_deduction_amount",
            "status",
            "source",
            "automation",
            "warning_notice",
            "attendance_result_id",
            "attendance_record_id",
            "description",
            "description_en",
            "description_ar",
            "note",
            "evidence",
            "employee_response",
            "dispute_reason",
            "resolution",
            "payroll_status",
            "source_page",
            "source_row",
            "created_at",
            "updated_at",
        ]

    def get_dispute_reason(self, obj):
        response = obj.employee_response or {}
        return response.get("reason") if response.get("decision") == "disputed" else None

    def get_payroll_status(self, obj):
        deduction = getattr(obj, "deduction", None)
        return deduction.status if deduction else None

    def get_warning_notice(self, obj):
        notice = getattr(obj, "warning_notice", None)
        if notice is None:
            return None
        return {
            "id": notice.pk,
            "reference_number": notice.reference_number,
            "delivery_status": notice.delivery_status,
            "issued_at": notice.issued_at,
            "download_path": f"/api/penalties/{obj.pk}/warning-notice/",
        }

    def to_representation(self, obj):
        data = super().to_representation(obj)
        request = self.context.get("request")
        if obj.automation and (request is None or get_role(request.user) not in {"HRManager", "SystemAdmin"}):
            # Employees never learn how many automatic warnings preceded this one.
            data["occurrence_number"] = None
            if isinstance(data.get("resolution"), dict):
                data["resolution"] = {
                    key: value
                    for key, value in data["resolution"].items()
                    if key in EMPLOYEE_AUTOMATION_RESOLUTION_KEYS
                }
        return data
