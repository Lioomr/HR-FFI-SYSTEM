from decimal import Decimal

from rest_framework import serializers

from employees.models import EmployeeProfile

from .models import LoanRequest


class LoanRequestReadSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    decision_history = serializers.SerializerMethodField()

    class Meta:
        model = LoanRequest
        fields = [
            "id",
            "employee",
            "requested_amount",
            "approved_amount",
            "reason",
            "status",
            "manager_decision_note",
            "finance_decision_note",
            "cfo_decision_note",
            "ceo_decision_note",
            "manager_decision_at",
            "finance_decision_at",
            "cfo_decision_at",
            "ceo_decision_at",
            "deducted_amount",
            "deducted_at",
            "decision_history",
            "created_at",
            "updated_at",
        ]

    def get_employee(self, obj):
        profile = obj.employee_profile
        return {
            "id": obj.employee_id,
            "email": obj.employee.email,
            "full_name": profile.full_name or obj.employee.full_name or obj.employee.email,
            "employee_profile_id": profile.id,
        }

    def get_decision_history(self, obj):
        history = [
            {
                "stage": "submitted",
                "actor_email": obj.employee.email,
                "at": obj.created_at,
                "note": obj.reason or "",
            }
        ]
        if obj.manager_decision_at:
            history.append(
                {
                    "stage": "manager",
                    "actor_email": obj.manager_decision_by.email if obj.manager_decision_by else None,
                    "at": obj.manager_decision_at,
                    "note": obj.manager_decision_note or "",
                }
            )
        if obj.finance_decision_at:
            history.append(
                {
                    "stage": "finance",
                    "actor_email": obj.finance_decision_by.email if obj.finance_decision_by else None,
                    "at": obj.finance_decision_at,
                    "note": obj.finance_decision_note or "",
                }
            )
        if obj.cfo_decision_at:
            history.append(
                {
                    "stage": "cfo",
                    "actor_email": obj.cfo_decision_by.email if obj.cfo_decision_by else None,
                    "at": obj.cfo_decision_at,
                    "note": obj.cfo_decision_note or "",
                }
            )
        if obj.ceo_decision_at:
            history.append(
                {
                    "stage": "ceo",
                    "actor_email": obj.ceo_decision_by.email if obj.ceo_decision_by else None,
                    "at": obj.ceo_decision_at,
                    "note": obj.ceo_decision_note or "",
                }
            )
        if obj.deducted_at:
            history.append(
                {
                    "stage": "deducted",
                    "actor_email": None,
                    "at": obj.deducted_at,
                    "note": f"Deducted amount: {obj.deducted_amount}",
                }
            )
        return history


class LoanRequestCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        request = self.context["request"]
        user = request.user

        try:
            profile = EmployeeProfile.objects.get(user=user)
        except EmployeeProfile.DoesNotExist as exc:
            raise serializers.ValidationError("Employee profile not found.") from exc

        if profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
            raise serializers.ValidationError("Only active employees can request loans.")

        if not profile.basic_salary or profile.basic_salary <= 0:
            raise serializers.ValidationError("Basic salary is not configured for this employee.")

        if attrs["amount"] > profile.basic_salary:
            raise serializers.ValidationError("Loan amount cannot exceed your basic salary.")

        attrs["employee_profile"] = profile
        return attrs


class LoanRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
