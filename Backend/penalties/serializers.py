from rest_framework import serializers

from .models import PenaltyCatalog, PenaltyRecord


class PenaltyCatalogSerializer(serializers.ModelSerializer):
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
