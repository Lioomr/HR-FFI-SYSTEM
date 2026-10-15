import re

from rest_framework import serializers

from .models import PayrollSettings


class MoneyInput(serializers.DecimalField):
    def __init__(self, **kwargs):
        super().__init__(max_digits=18, decimal_places=2, min_value=0, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str) or not re.fullmatch(r"\d+(?:\.\d{1,2})?", data):
            raise serializers.ValidationError("payroll.validation.invalid_decimal", code="invalid_decimal")
        return super().to_internal_value(data)


class RateInput(MoneyInput):
    def __init__(self, **kwargs):
        serializers.DecimalField.__init__(self, max_digits=8, decimal_places=6, min_value=0, max_value=1, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str) or not re.fullmatch(r"\d+(?:\.\d{1,6})?", data):
            raise serializers.ValidationError("payroll.validation.invalid_decimal", code="invalid_decimal")
        return serializers.DecimalField.to_internal_value(self, data)


class SalaryBaseInput(serializers.Serializer):
    type = serializers.ChoiceField(choices=PayrollSettings.SalaryBase.choices)
    fixed_amount = MoneyInput(allow_null=True)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError("payroll.validation.field_not_editable", code="field_not_editable")
        return super().to_internal_value(data)

    def validate(self, attrs):
        if (attrs["type"] == "FIXED_AMOUNT") != (attrs["fixed_amount"] is not None):
            raise serializers.ValidationError(
                {"fixed_amount": serializers.ErrorDetail("payroll.validation.invalid_choice", code="invalid_choice")}
            )
        return attrs


class SettingsUpdateSerializer(serializers.Serializer):
    expected_revision = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(allow_blank=False, trim_whitespace=True)
    absence_base = SalaryBaseInput(required=False)
    gosi_base = SalaryBaseInput(required=False)
    leave_base = SalaryBaseInput(required=False)
    eos_base = SalaryBaseInput(required=False)
    overtime_base = SalaryBaseInput(required=False)
    foreign_gosi_rate = RateInput(required=False)
    saudi_gosi_rate = RateInput(required=False)
    annual_medical_invoice = MoneyInput(required=False, allow_null=True)
    no_medical_insurance = serializers.BooleanField(required=False)
    monthly_foreign_id_cost = MoneyInput(required=False)
    annual_air_ticket = MoneyInput(required=False)
    provision_proration = serializers.ChoiceField(choices=PayrollSettings.ProvisionProration.choices, required=False)
    require_manual_absence_confirmation = serializers.BooleanField(required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    {
                        key: serializers.ErrorDetail("payroll.validation.field_not_editable", code="field_not_editable")
                        for key in sorted(unknown)
                    }
                )
            for key in ("no_medical_insurance", "require_manual_absence_confirmation"):
                if key in data and not isinstance(data[key], bool):
                    raise serializers.ValidationError(
                        {key: serializers.ErrorDetail("payroll.validation.invalid_choice", code="invalid_choice")}
                    )
        return super().to_internal_value(data)


class EmployeeGosiUpdateSerializer(serializers.Serializer):
    expected_revision = serializers.IntegerField(min_value=0)
    deduct_gosi_from_employee = serializers.BooleanField()
    reason = serializers.CharField(allow_blank=False, trim_whitespace=True)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            if set(data) - set(self.fields):
                raise serializers.ValidationError("payroll.validation.field_not_editable", code="field_not_editable")
            if "deduct_gosi_from_employee" in data and not isinstance(data["deduct_gosi_from_employee"], bool):
                raise serializers.ValidationError(
                    {
                        "deduct_gosi_from_employee": serializers.ErrorDetail(
                            "payroll.validation.invalid_choice", code="invalid_choice"
                        )
                    }
                )
        return super().to_internal_value(data)


class PayrollSettingsSerializer(serializers.Serializer):
    def to_representation(self, instance):
        from .i18n import translated

        snapshot = instance.snapshot()
        if instance.pk is None:
            snapshot["settings_revision"] = 0
        snapshot.pop("schema_version")
        snapshot.pop("payroll_timezone")
        snapshot.update(
            id=instance.pk,
            updated_at=instance.updated_at.isoformat() if instance.updated_at else None,
            assumptions=[
                {"key": key, "message": translated(key)}
                for key in (
                    "payroll.assumption.overtime_basic",
                    "payroll.assumption.overtime_calendar_month",
                )
            ],
        )
        return snapshot
