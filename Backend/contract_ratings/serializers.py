from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from core.services import get_workflow_snapshot_read_only
from employees.contract_expiry import contract_terms_snapshot
from employees.models import ContractDecision

from .criteria import ChangeType, Recommendation
from .models import ContractRating, ContractRatingResponse
from .permissions import viewer_role
from .scoring import validate_criterion_ratings


class ContractRatingResponseWriteSerializer(serializers.Serializer):
    criterion_ratings = serializers.JSONField()
    overall_remark = serializers.CharField(required=False, allow_blank=True, default="")
    recommendation = serializers.ChoiceField(choices=Recommendation.choices, required=False)
    recommended_change_types = serializers.ListField(
        child=serializers.ChoiceField(choices=ChangeType.choices), required=False, default=list
    )
    proposed_terms = serializers.JSONField(required=False, default=dict)
    proposed_job_title = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    proposed_position_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    other_change_notes = serializers.CharField(required=False, allow_blank=True, default="")
    salary_effective_date = serializers.DateField(required=False)

    def validate_criterion_ratings(self, value):
        try:
            return validate_criterion_ratings(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from None

    def validate(self, attrs):
        manager_fields = {
            "recommendation",
            "recommended_change_types",
            "proposed_terms",
            "proposed_job_title",
            "proposed_position_id",
            "other_change_notes",
            "salary_effective_date",
        }
        if not self.context.get("is_manager"):
            if manager_fields & set(self.initial_data):
                raise serializers.ValidationError("Employee responses cannot contain manager recommendation fields.")
            return {key: value for key, value in attrs.items() if key not in manager_fields}
        from .services import validate_manager_proposal

        try:
            attrs.update(validate_manager_proposal(attrs, self.context["profile"]))
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from None
        if "salary_effective_date" in attrs and ChangeType.SALARY_INCREASE not in attrs["recommended_change_types"]:
            raise serializers.ValidationError("A salary effective date requires a salary proposal.")
        return attrs


class CeoDecisionWriteSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=ContractRating.CeoAction.choices)
    comment = serializers.CharField(required=False, allow_blank=True, default="")
    ceo_selected_option = serializers.ChoiceField(
        choices=ContractDecision.DecisionType.choices, required=False, allow_blank=True, default=""
    )
    ceo_approved_terms = serializers.JSONField(required=False, allow_null=True)
    ceo_salary_override_reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        action = attrs["action"]
        if (
            action == "DECLINE_WITH_ALTERNATIVE"
            and attrs["ceo_selected_option"] == "RENEW_WITH_CHANGES"
            and attrs.get("ceo_approved_terms") is not None
            and not isinstance(attrs["ceo_approved_terms"], dict)
        ):
            raise serializers.ValidationError({"ceo_approved_terms": "Expected an object."})
        if action != "ACCEPT" and not attrs["comment"].strip():
            raise serializers.ValidationError({"comment": "A reason is required."})
        if (action == "DECLINE_WITH_ALTERNATIVE") != bool(attrs["ceo_selected_option"]):
            raise serializers.ValidationError(
                {"ceo_selected_option": "Select an option only for DECLINE_WITH_ALTERNATIVE."}
            )
        return attrs


class HrReviewWriteSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["approve", "return", "return-manager", "return-employee", "return-both"])
    comment = serializers.CharField(required=False, allow_blank=True, default="")
    targets = serializers.ListField(
        child=serializers.ChoiceField(choices=ContractRatingResponse.RaterType.choices), required=False
    )


class ContractRatingResponseReadSerializer(serializers.ModelSerializer):
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True, default="")

    class Meta:
        model = ContractRatingResponse
        fields = "__all__"


class ContractRatingReadSerializer(serializers.ModelSerializer):
    manager_response = ContractRatingResponseReadSerializer(read_only=True)
    employee_response = ContractRatingResponseReadSerializer(read_only=True)

    class Meta:
        model = ContractRating
        fields = "__all__"

    def to_representation(self, obj):
        request = self.context.get("request")
        actor = request.user if request else None
        role = viewer_role(actor, obj)
        if role is None:
            return {}
        profile = obj.employee_profile
        header = {
            "id": obj.id,
            "status": obj.status,
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
            if role == "employee" and payload:
                for field in (
                    "recommendation",
                    "recommended_change_types",
                    "proposed_terms",
                    "proposed_job_title",
                    "proposed_position_id",
                    "other_change_notes",
                ):
                    payload.pop(field, None)
            return {**header, f"{role}_response": payload}
        result = {**super().to_representation(obj), **header}
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
        result["hr_reviewed_by_name"] = obj.hr_reviewed_by.full_name if obj.hr_reviewed_by else ""
        result["ceo_decided_by_name"] = obj.ceo_decided_by.full_name if obj.ceo_decided_by else ""
        before = obj.salary_before_snapshot or result["current_terms"]
        proposal = obj.ceo_approved_terms or (obj.manager_response.proposed_terms if obj.manager_response else {})
        base = Decimal(before.get("total_salary") or "0")
        proposed_total = Decimal(proposal.get("total_salary") or base)
        difference = proposed_total - base
        result["salary_increase_amount"] = str(difference)
        result["salary_increase_percent"] = str((difference * 100 / base).quantize(Decimal("0.01"))) if base else None
        return result
