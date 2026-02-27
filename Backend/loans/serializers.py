from calendar import monthrange
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from employees.models import EmployeeProfile

from .models import LoanRequest


class LoanRequestReadSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    decision_history = serializers.SerializerMethodField()
    target_deduction_period = serializers.SerializerMethodField()

    class Meta:
        model = LoanRequest
        fields = [
            "id",
            "employee",
            "requested_amount",
            "approved_amount",
            "loan_type",
            "installment_months",
            "reason",
            "status",
            "manager_recommendation",
            "hr_recommendation",
            "manager_decision_note",
            "finance_decision_note",
            "cfo_decision_note",
            "ceo_decision_note",
            "disbursed_at",
            "disbursed_by",
            "disbursement_note",
            "manager_decision_at",
            "finance_decision_at",
            "cfo_decision_at",
            "ceo_decision_at",
            "deducted_amount",
            "deducted_at",
            "approved_year",
            "approved_month",
            "target_deduction_year",
            "target_deduction_month",
            "target_deduction_period",
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
            stage = (
                "manager_recommended_reject"
                if obj.manager_recommendation == LoanRequest.Recommendation.REJECT
                else "manager_recommended_approve"
            )
            history.append(
                {
                    "stage": stage,
                    "actor_email": obj.manager_decision_by.email if obj.manager_decision_by else None,
                    "at": obj.manager_decision_at,
                    "note": obj.manager_decision_note or "",
                }
            )
        if obj.finance_decision_at:
            stage = (
                "hr_recommended_reject"
                if obj.hr_recommendation == LoanRequest.Recommendation.REJECT
                else "hr_recommended_approve"
            )
            history.append(
                {
                    "stage": stage,
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
        if obj.disbursed_at:
            history.append(
                {
                    "stage": "disbursed",
                    "actor_email": obj.disbursed_by.email if obj.disbursed_by else None,
                    "at": obj.disbursed_at,
                    "note": obj.disbursement_note or "",
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

    def get_target_deduction_period(self, obj):
        if obj.target_deduction_year and obj.target_deduction_month:
            return f"{obj.target_deduction_year}-{obj.target_deduction_month:02d}"
        return None


class LoanRequestCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    loan_type = serializers.ChoiceField(
        choices=LoanRequest.LoanType.choices,
        required=False,
        default=LoanRequest.LoanType.OPEN,
    )
    installment_months = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=10)
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

        loan_type = attrs.get("loan_type", LoanRequest.LoanType.OPEN)
        amount = attrs["amount"]
        installment_months = attrs.get("installment_months")

        if loan_type == LoanRequest.LoanType.OPEN:
            if installment_months:
                raise serializers.ValidationError({"installment_months": "Installment months are only for installment loans."})

            today = timezone.localdate()
            days_in_month = monthrange(today.year, today.month)[1]
            if today.day < (days_in_month - 9):
                raise serializers.ValidationError("Open loan requests are only allowed in the last 10 days of the month.")

            open_limit = profile.basic_salary * Decimal("0.25")
            if amount > open_limit:
                raise serializers.ValidationError(
                    {"amount": f"Open loan amount cannot exceed 25% of basic salary ({open_limit})."}
                )
        else:
            if installment_months is None:
                raise serializers.ValidationError({"installment_months": "Installment months are required for installment loans."})

            joining_date = profile.hire_date or profile.contract_date
            if not joining_date:
                raise serializers.ValidationError(
                    {"loan_type": "Installment loan requires a configured joining date for eligibility check."}
                )

            today = timezone.localdate()
            months_of_service = (today.year - joining_date.year) * 12 + (today.month - joining_date.month)
            if today.day < joining_date.day:
                months_of_service -= 1

            if months_of_service < 6:
                raise serializers.ValidationError(
                    {"loan_type": "Installment loan is allowed only after completing at least 6 months of service."}
                )

            if amount > profile.basic_salary:
                raise serializers.ValidationError("Loan amount cannot exceed your basic salary.")

        attrs["employee_profile"] = profile
        return attrs


class LoanRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
