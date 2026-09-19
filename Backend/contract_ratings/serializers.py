from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from core.permissions import get_role
from core.services import get_workflow_snapshot_read_only
from employees.contract_expiry import contract_terms_snapshot
from employees.models import ContractDecision

from .models import ContractRating, ContractRatingResponse
from .permissions import viewer_role
from .scoring import validate_criterion_ratings

RETURN_TO_MANAGER = "RETURN_TO_MANAGER"
RETURN_TO_EMPLOYEE = "RETURN_TO_EMPLOYEE"
RETURN_TO_BOTH = "RETURN_TO_BOTH"
CEO_DECISION_CHOICES = [
    *ContractDecision.DecisionType.choices,
    (RETURN_TO_MANAGER, "Return to manager"),
    (RETURN_TO_EMPLOYEE, "Return to employee"),
    (RETURN_TO_BOTH, "Return to both"),
]


class HrGateWriteSerializer(serializers.Serializer):
    rating_mode = serializers.ChoiceField(choices=ContractRating.RatingMode.choices)


class ContractRatingResponseWriteSerializer(serializers.Serializer):
    criterion_ratings = serializers.JSONField()
    overall_remark = serializers.CharField(required=False, allow_blank=True, default="")

    ignored_computed_fields = {"average_score", "overall_grade"}

    def validate_criterion_ratings(self, value):
        try:
            return validate_criterion_ratings(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from None

    def validate(self, attrs):
        allowed = {"criterion_ratings", "overall_remark"} | self.ignored_computed_fields
        unexpected = sorted(set(self.initial_data) - allowed)
        if unexpected:
            raise serializers.ValidationError({field: "This field is not accepted." for field in unexpected})
        return attrs


class CeoDecisionWriteSerializer(serializers.Serializer):
    ceo_decision = serializers.ChoiceField(choices=CEO_DECISION_CHOICES)
    comment = serializers.CharField(required=False, allow_blank=True, default="")
    ceo_approved_terms = serializers.JSONField(required=False)
    salary_effective_date = serializers.DateField(required=False)

    def validate(self, attrs):
        decision = attrs["ceo_decision"]
        terms_supplied = "ceo_approved_terms" in self.initial_data
        date_supplied = "salary_effective_date" in self.initial_data
        if terms_supplied and not isinstance(attrs.get("ceo_approved_terms"), dict):
            raise serializers.ValidationError({"ceo_approved_terms": "Expected an object."})
        if decision in {RETURN_TO_MANAGER, RETURN_TO_EMPLOYEE, RETURN_TO_BOTH} and not attrs["comment"].strip():
            raise serializers.ValidationError({"comment": "A reason is required."})
        if decision == ContractDecision.DecisionType.RENEW_WITH_CHANGES:
            if not attrs.get("ceo_approved_terms"):
                raise serializers.ValidationError({"ceo_approved_terms": "Salary terms are required."})
            if not attrs.get("salary_effective_date"):
                raise serializers.ValidationError({"salary_effective_date": "An effective date is required."})
        elif terms_supplied or date_supplied:
            raise serializers.ValidationError(
                {"ceo_approved_terms": "Salary terms are accepted only for RENEW_WITH_CHANGES."}
            )
        return attrs


class HrCommentWriteSerializer(serializers.Serializer):
    comment = serializers.CharField(allow_blank=False, trim_whitespace=True)


class ContractRatingResponseReadSerializer(serializers.ModelSerializer):
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True, default="")

    class Meta:
        model = ContractRatingResponse
        fields = (
            "id",
            "rater_type",
            "status",
            "submitted_by",
            "submitted_by_name",
            "criterion_ratings",
            "average_score",
            "overall_grade",
            "overall_remark",
            "submitted_at",
            "returned_at",
            "returned_by",
            "return_reason",
            "created_at",
            "updated_at",
        )


class ContractRatingReadSerializer(serializers.ModelSerializer):
    manager_response = ContractRatingResponseReadSerializer(read_only=True)
    employee_response = ContractRatingResponseReadSerializer(read_only=True)

    class Meta:
        model = ContractRating
        fields = (
            "id",
            "contract_decision",
            "company",
            "status",
            "rating_mode",
            "hr_gate_decided_by",
            "hr_gate_decided_at",
            "manager_response",
            "employee_response",
            "manager_at_creation",
            "department_snapshot",
            "section_snapshot",
            "job_title_snapshot",
            "evaluation_period_from",
            "evaluation_period_to",
            "comparison_summary",
            "hr_comment_requested_by",
            "hr_comment_requested_at",
            "hr_comment_by",
            "hr_comment",
            "hr_comment_submitted_at",
            "ceo_decision",
            "ceo_decided_by",
            "ceo_comment",
            "ceo_decided_at",
            "salary_before_snapshot",
            "ceo_approved_terms",
            "salary_effective_date",
            "salary_change_applied_at",
            "salary_after_snapshot",
            "scheduled_termination",
            "employee_notified_of_termination_at",
            "employee_notified_of_termination_by",
            "termination_processed_at",
            "created_at",
            "updated_at",
        )

    def to_representation(self, obj):
        request = self.context.get("request")
        actor = request.user if request else None
        role = self.context.get("viewer_role_override") or viewer_role(actor, obj)
        if role is None:
            return {}
        profile = obj.employee_profile
        header = {
            "id": obj.id,
            "status": obj.status,
            "rating_mode": obj.rating_mode,
            "company": obj.company_id,
            "employee": {
                "id": profile.id,
                "employee_id": profile.employee_id,
                "employee_number": profile.employee_number,
                "full_name": profile.full_name,
                "department": obj.department_snapshot,
                "section": obj.section_snapshot,
                "job_title": obj.job_title_snapshot,
                "manager_at_creation": obj.manager_at_creation_id,
            },
            "evaluation_period_from": obj.evaluation_period_from.isoformat() if obj.evaluation_period_from else None,
            "evaluation_period_to": obj.evaluation_period_to.isoformat() if obj.evaluation_period_to else None,
            "contract_date": profile.contract_date.isoformat() if profile.contract_date else None,
            "contract_expiry": profile.contract_expiry.isoformat() if profile.contract_expiry else None,
            "manager_name": obj.manager_at_creation.full_name if obj.manager_at_creation else "",
        }
        if role in {"employee", "manager"}:
            response = getattr(obj, f"{role}_response")
            payload = ContractRatingResponseReadSerializer(response).data if response else None
            return {**header, f"{role}_response": payload}
        if role == "hr" and not obj.hr_comment_requested_at:
            result = dict(header)
            result["hr_comment_requested_at"] = None
            if obj.status == ContractRating.Status.PENDING_HR_GATE and get_role(actor) != "SystemAdmin":
                result.update(
                    {
                        "account_connected": bool(profile.user_id),
                        "hr_gate_decided_by": obj.hr_gate_decided_by_id,
                        "hr_gate_decided_by_name": obj.hr_gate_decided_by.full_name if obj.hr_gate_decided_by else "",
                        "hr_gate_decided_at": obj.hr_gate_decided_at,
                    }
                )
            if obj.ceo_decision:
                result.update(
                    {
                        "ceo_decision": obj.ceo_decision,
                        "ceo_comment": obj.ceo_comment,
                        "ceo_decided_at": obj.ceo_decided_at,
                        "ceo_decided_by": obj.ceo_decided_by_id,
                        "ceo_approved_terms": obj.ceo_approved_terms,
                        "salary_effective_date": obj.salary_effective_date,
                        "salary_change_applied_at": obj.salary_change_applied_at,
                        "salary_after_snapshot": obj.salary_after_snapshot,
                        "scheduled_termination": obj.scheduled_termination,
                        "employee_notified_of_termination_at": obj.employee_notified_of_termination_at,
                        "employee_notified_of_termination_by": obj.employee_notified_of_termination_by_id,
                        "termination_processed_at": obj.termination_processed_at,
                    }
                )
            return result
        result = {**super().to_representation(obj), **header}
        if obj.rating_mode == ContractRating.RatingMode.SKIP_TO_CEO:
            result.pop("manager_response", None)
            result.pop("employee_response", None)
            result.pop("comparison_summary", None)
        result["workflow"] = get_workflow_snapshot_read_only(obj, actor=actor)
        result["current_terms"] = contract_terms_snapshot(profile)
        result["contract_date"] = profile.contract_date.isoformat() if profile.contract_date else None
        result["contract_expiry"] = profile.contract_expiry.isoformat() if profile.contract_expiry else None
        result["remaining_contract_days"] = (
            (profile.contract_expiry - timezone.localdate()).days if profile.contract_expiry else None
        )
        result["employment_status"] = profile.employment_status
        result["is_archived"] = profile.is_archived
        result["archive_reason"] = profile.archive_reason
        result["hr_comment_requested_by_name"] = (
            obj.hr_comment_requested_by.full_name if obj.hr_comment_requested_by else ""
        )
        result["hr_gate_decided_by_name"] = obj.hr_gate_decided_by.full_name if obj.hr_gate_decided_by else ""
        result["hr_comment_by_name"] = obj.hr_comment_by.full_name if obj.hr_comment_by else ""
        result["ceo_decided_by_name"] = obj.ceo_decided_by.full_name if obj.ceo_decided_by else ""
        before = obj.salary_before_snapshot or result["current_terms"]
        proposal = obj.ceo_approved_terms or {}
        base = Decimal(before.get("total_salary") or "0")
        proposed_total = Decimal(proposal.get("total_salary") or base)
        difference = proposed_total - base
        result["salary_increase_amount"] = str(difference)
        result["salary_increase_percent"] = str((difference * 100 / base).quantize(Decimal("0.01"))) if base else None
        return result
