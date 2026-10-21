from rest_framework import serializers

from .models import PayrollRun, PayrollRunItem, Payslip


class PayrollRunSerializer(serializers.ModelSerializer):
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = PayrollRun
        fields = [
            "id",
            "year",
            "month",
            "calendar_days",
            "period_start",
            "period_end",
            "period_basis",
            "status",
            "total_net",
            "total_employees",
            "company_id",
            "company_name",
        ]
        read_only_fields = ["year", "month", "calendar_days", "period_basis"]

    def validate_month(self, value):
        if value < 1 or value > 12:
            raise serializers.ValidationError("Month must be between 1 and 12.")
        return value

    def validate_year(self, value):
        if value < 1900 or value > 2100:
            raise serializers.ValidationError("Year is out of range.")
        return value


class PayrollRunCreateSerializer(PayrollRunSerializer):
    class Meta(PayrollRunSerializer.Meta):
        fields = ["period_start", "period_end"]
        read_only_fields = []

    def validate(self, attrs):
        attrs = super().validate(attrs)
        start, end = attrs.get("period_start"), attrs.get("period_end")
        if (
            start is None
            or end is None
            or not 1900 <= start.year <= 2100
            or not 1900 <= end.year <= 2100
            or not 1 <= (end - start).days + 1 <= 30
        ):
            raise serializers.ValidationError({"period_end": "invalid_date_range"})
        return attrs


class PayrollRunItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollRunItem
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "department",
            "position",
            "basic_salary",
            "total_allowances",
            "total_deductions",
            "net_salary",
        ]


class PayslipListSerializer(serializers.ModelSerializer):
    period_start = serializers.DateField(source="payroll_run.period_start", read_only=True)
    period_end = serializers.DateField(source="payroll_run.period_end", read_only=True)

    class Meta:
        model = Payslip
        fields = ["id", "year", "month", "period_start", "period_end", "net_salary", "payment_mode", "status"]


class PayslipDetailSerializer(serializers.Serializer):
    def to_representation(self, instance):
        from .dto import employee_dto

        return employee_dto(instance)
