from rest_framework import serializers

from .models import PayrollRun, PayrollRunItem, Payslip


class PayrollRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollRun
        fields = ["id", "year", "month", "status", "total_net", "total_employees"]

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
        fields = ["year", "month"]


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
    class Meta:
        model = Payslip
        fields = ["id", "year", "month", "net_salary", "payment_mode", "status"]


class PayslipDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payslip
        fields = [
            "id",
            "year",
            "month",
            "basic_salary",
            "transportation_allowance",
            "accommodation_allowance",
            "telephone_allowance",
            "petrol_allowance",
            "other_allowance",
            "total_salary",
            "total_deductions",
            "net_salary",
            "payment_mode",
            "status",
        ]
