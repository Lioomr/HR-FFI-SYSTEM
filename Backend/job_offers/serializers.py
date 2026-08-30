from decimal import Decimal

from rest_framework import serializers

from core.permissions import get_role
from core.services.messaging_providers import is_e164, normalize_phone_number
from core.services.workflow_engine import get_workflow_snapshot
from hr_reference.models import Department, Position

from .file_validation import validate_job_offer_cv
from .models import JobOffer
from .services import get_biotime_status


class JobOfferSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    employee_profile_id = serializers.IntegerField(read_only=True)
    department_id = serializers.PrimaryKeyRelatedField(
        source="department_ref", queryset=Department.objects.none(), required=False, allow_null=True
    )
    position_id = serializers.PrimaryKeyRelatedField(
        source="position_ref", queryset=Position.objects.none(), required=False, allow_null=True
    )
    position_title = serializers.CharField(required=False)
    account_invite_id = serializers.IntegerField(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    approval_status_label = serializers.CharField(source="get_approval_status_display", read_only=True)
    has_response_token = serializers.SerializerMethodField()
    has_cv = serializers.SerializerMethodField()
    cv_download_url = serializers.SerializerMethodField()
    biotime = serializers.SerializerMethodField()
    workflow = serializers.SerializerMethodField()
    hr_signer_user_id = serializers.IntegerField(read_only=True)
    ceo_decision_by_id = serializers.IntegerField(read_only=True)
    ceo_decision_by_name = serializers.SerializerMethodField()
    created_by_id = serializers.IntegerField(read_only=True)
    updated_by_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = JobOffer
        fields = [
            "id",
            "company_id",
            "company_name",
            "employee_profile_id",
            "account_invite_id",
            "candidate_full_name",
            "candidate_email",
            "candidate_phone_number",
            "nationality",
            "date_of_birth",
            "id_passport_iqama_number",
            "cv_file",
            "has_cv",
            "cv_download_url",
            "department_id",
            "position_id",
            "position_title",
            "classification",
            "department",
            "location",
            "basic_salary",
            "housing_allowance",
            "transportation_allowance",
            "other_allowance",
            "total_salary_package",
            "vacation",
            "tickets",
            "contract_status",
            "contract_type",
            "contract_duration",
            "medical_insurance",
            "offer_date",
            "expiry_date",
            "reference_number",
            "hr_signer_user_id",
            "hr_signer_name",
            "hr_signer_title",
            "status",
            "status_label",
            "approval_status",
            "approval_status_label",
            "submitted_at",
            "ceo_decision_by_id",
            "ceo_decision_by_name",
            "ceo_decision_at",
            "ceo_decision_reason",
            "ceo_recommendation",
            "workflow",
            "has_response_token",
            "biotime",
            "sent_at",
            "accepted_at",
            "rejected_at",
            "cancelled_at",
            "rejection_reason",
            "delivery_metadata",
            "created_by_id",
            "updated_by_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "status",
            "approval_status",
            "submitted_at",
            "ceo_decision_by_id",
            "ceo_decision_at",
            "ceo_decision_reason",
            "ceo_recommendation",
            "sent_at",
            "accepted_at",
            "rejected_at",
            "cancelled_at",
            "rejection_reason",
            "delivery_metadata",
            "reference_number",
            "hr_signer_user_id",
            "hr_signer_name",
            "hr_signer_title",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {"cv_file": {"write_only": True}}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        company = self.context.get("company")
        if company:
            self.fields["department_id"].queryset = Department.objects.filter(company=company, is_active=True)
            self.fields["position_id"].queryset = Position.objects.filter(company=company, is_active=True)
        if self.instance is None:
            self.fields["cv_file"].required = True

    def get_has_response_token(self, obj: JobOffer) -> bool:
        return bool(obj.response_token)

    def get_has_cv(self, obj: JobOffer) -> bool:
        return bool(obj.cv_file)

    def get_cv_download_url(self, obj: JobOffer) -> str | None:
        if not obj.cv_file:
            return None
        request = self.context.get("request")
        path = f"/job-offers/{obj.id}/cv/"
        return request.build_absolute_uri(path) if request else path

    def get_biotime(self, obj: JobOffer) -> dict:
        return get_biotime_status(obj.employee_profile)

    def get_ceo_decision_by_name(self, obj: JobOffer) -> str | None:
        user = obj.ceo_decision_by
        return (user.full_name or user.email or "").strip() if user else None

    def get_workflow(self, obj: JobOffer) -> dict:
        request = self.context.get("request")
        actor = request.user if request else None
        snapshot = get_workflow_snapshot(obj, actor=actor)
        is_hr = bool(actor and get_role(actor) in {"HRManager", "SystemAdmin"})
        editable_by_hr = obj.approval_status in {
            JobOffer.ApprovalStatus.DRAFT,
            JobOffer.ApprovalStatus.CHANGES_REQUESTED,
        }
        snapshot["can_edit"] = bool(
            (is_hr and editable_by_hr)
            or (snapshot["can_approve"] and obj.approval_status == JobOffer.ApprovalStatus.PENDING_CEO)
        )
        snapshot["can_submit"] = bool(
            is_hr and editable_by_hr and obj.status == JobOffer.Status.DRAFT and obj.cv_file and not obj.is_expired()
        )
        snapshot["can_request_changes"] = bool(
            snapshot["can_approve"] and obj.approval_status == JobOffer.ApprovalStatus.PENDING_CEO
        )
        snapshot["can_cancel"] = bool(
            is_hr
            and obj.approval_status != JobOffer.ApprovalStatus.PENDING_CEO
            and obj.status in {JobOffer.Status.DRAFT, JobOffer.Status.SENT}
        )
        snapshot["can_send"] = bool(
            is_hr
            and obj.approval_status == JobOffer.ApprovalStatus.APPROVED
            and obj.status == JobOffer.Status.DRAFT
            and not obj.is_expired()
        )
        return snapshot

    def validate_candidate_phone_number(self, value: str) -> str:
        if not value:
            return ""
        normalized = normalize_phone_number(value)
        if not normalized or not is_e164(normalized):
            raise serializers.ValidationError("Phone number must be in E.164 format.")
        return normalized

    def validate_cv_file(self, value):
        return validate_job_offer_cv(value)

    def validate(self, attrs):
        offer_date = attrs.get("offer_date", getattr(self.instance, "offer_date", None))
        expiry_date = attrs.get("expiry_date", getattr(self.instance, "expiry_date", None))
        if offer_date and expiry_date and expiry_date < offer_date:
            raise serializers.ValidationError({"expiry_date": ["Expiry date cannot be before offer date."]})

        for field in (
            "basic_salary",
            "housing_allowance",
            "transportation_allowance",
            "other_allowance",
            "total_salary_package",
        ):
            value = attrs.get(field, getattr(self.instance, field, Decimal("0")))
            if value is not None and value < 0:
                raise serializers.ValidationError({field: ["Amount cannot be negative."]})

        if self.instance is None:
            errors = {}
            if not attrs.get("candidate_email") and not attrs.get("candidate_phone_number"):
                errors["candidate_email"] = ["Candidate email or phone number is required."]
            if not attrs.get("department_ref"):
                errors["department_id"] = ["This field is required."]
            if not attrs.get("position_ref"):
                errors["position_id"] = ["This field is required."]
            if errors:
                raise serializers.ValidationError(errors)

        component_fields = (
            "basic_salary",
            "housing_allowance",
            "transportation_allowance",
            "other_allowance",
        )
        if "total_salary_package" not in attrs and self.instance is None:
            attrs["total_salary_package"] = sum((attrs.get(field) or Decimal("0")) for field in component_fields)
        return attrs

    @staticmethod
    def _sync_reference_names(validated_data, instance=None):
        department = validated_data.get("department_ref", instance.department_ref if instance else None)
        position = validated_data.get("position_ref", instance.position_ref if instance else None)
        if department is not None:
            validated_data["department"] = department.name or department.code
        if position is not None:
            validated_data["position_title"] = position.name or position.code

    def create(self, validated_data):
        self._sync_reference_names(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._sync_reference_names(validated_data, instance)
        return super().update(instance, validated_data)


class JobOfferApprovalSerializer(serializers.Serializer):
    recommendation = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")


class JobOfferRevisionSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=4000, trim_whitespace=True)
    recommendation = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")

    def validate_reason(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("This field may not be blank.")
        return value.strip()


class JobOfferRejectionSerializer(JobOfferRevisionSerializer):
    pass


class JobOfferResponseSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)
    decision = serializers.ChoiceField(choices=("accepted", "rejected"))
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate(self, attrs):
        if attrs["decision"] == "accepted" and attrs.get("reason"):
            attrs["reason"] = ""
        return attrs


class PublicJobOfferSerializer(serializers.ModelSerializer):
    total_salary_package = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    can_respond = serializers.SerializerMethodField()

    class Meta:
        model = JobOffer
        fields = [
            "candidate_full_name",
            "position_title",
            "department",
            "location",
            "total_salary_package",
            "offer_date",
            "expiry_date",
            "status",
            "status_label",
            "can_respond",
        ]

    def get_can_respond(self, obj: JobOffer) -> bool:
        return obj.status == JobOffer.Status.SENT and not obj.is_expired()
