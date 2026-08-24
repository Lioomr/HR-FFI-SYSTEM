from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.permissions import get_role
from core.services.messaging_providers import is_e164, normalize_phone_number
from core.services.workflow_engine import get_workflow_snapshot
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position

from .file_validation import validate_hiring_request_cv
from .models import HiringRequest, JobOffer
from .services import get_biotime_status

User = get_user_model()


class JobOfferSerializer(serializers.ModelSerializer):
    LINKED_SOURCE_FIELDS = {
        "candidate_full_name",
        "candidate_email",
        "candidate_phone_number",
        "nationality",
        "basic_salary",
        "company",
        "company_id",
        "hiring_request_id",
        "employee_profile_id",
    }

    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    employee_profile_id = serializers.PrimaryKeyRelatedField(
        source="employee_profile",
        queryset=EmployeeProfile.objects.none(),
        required=False,
        allow_null=True,
    )
    department_id = serializers.PrimaryKeyRelatedField(
        source="department_ref",
        queryset=Department.objects.none(),
        required=False,
        allow_null=True,
    )
    position_id = serializers.PrimaryKeyRelatedField(
        source="position_ref",
        queryset=Position.objects.none(),
        required=False,
        allow_null=True,
    )
    position_title = serializers.CharField(required=False)
    account_invite_id = serializers.IntegerField(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    has_response_token = serializers.SerializerMethodField()
    biotime = serializers.SerializerMethodField()
    hr_signer_user_id = serializers.IntegerField(read_only=True)
    created_by_id = serializers.IntegerField(read_only=True)
    updated_by_id = serializers.IntegerField(read_only=True)
    hiring_request_id = serializers.PrimaryKeyRelatedField(
        source="hiring_request",
        queryset=HiringRequest.objects.none(),
        required=False,
        allow_null=True,
    )
    hiring_request_reference = serializers.CharField(source="hiring_request.reference_number", read_only=True)
    hiring_request_status = serializers.CharField(source="hiring_request.status", read_only=True)

    class Meta:
        model = JobOffer
        fields = [
            "id",
            "company_id",
            "company_name",
            "employee_profile_id",
            "account_invite_id",
            "hiring_request_id",
            "hiring_request_reference",
            "hiring_request_status",
            "candidate_full_name",
            "candidate_email",
            "candidate_phone_number",
            "nationality",
            "id_passport_iqama_number",
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        company = self.context.get("company")
        if company:
            self.fields["employee_profile_id"].queryset = EmployeeProfile.objects.filter(company=company)
            self.fields["hiring_request_id"].queryset = HiringRequest.objects.filter(company=company)
            self.fields["department_id"].queryset = Department.objects.filter(company=company, is_active=True)
            self.fields["position_id"].queryset = Position.objects.filter(company=company, is_active=True)

    def get_has_response_token(self, obj: JobOffer) -> bool:
        return bool(obj.response_token)

    def get_biotime(self, obj: JobOffer) -> dict:
        return get_biotime_status(obj.employee_profile)

    def to_internal_value(self, data):
        if self.instance and self.instance.hiring_request_id:
            errors = {
                field: ["This field is controlled by the linked hiring request and cannot be edited."]
                for field in self.LINKED_SOURCE_FIELDS
                if field in data
            }
            if errors:
                raise serializers.ValidationError(errors)
        return super().to_internal_value(data)

    def validate_candidate_phone_number(self, value: str) -> str:
        if not value:
            return ""
        normalized = normalize_phone_number(value)
        if not normalized or not is_e164(normalized):
            raise serializers.ValidationError("Phone number must be in E.164 format.")
        return normalized

    def validate(self, attrs):
        if self.instance:
            attrs.pop("hiring_request", None)
        offer_date = attrs.get("offer_date", getattr(self.instance, "offer_date", None))
        expiry_date = attrs.get("expiry_date", getattr(self.instance, "expiry_date", None))
        if offer_date and expiry_date and expiry_date < offer_date:
            raise serializers.ValidationError({"expiry_date": ["Expiry date cannot be before offer date."]})

        salary_fields = (
            "basic_salary",
            "housing_allowance",
            "transportation_allowance",
            "other_allowance",
            "total_salary_package",
        )
        for field in salary_fields:
            value = attrs.get(field, getattr(self.instance, field, Decimal("0")))
            if value is not None and value < 0:
                raise serializers.ValidationError({field: ["Amount cannot be negative."]})

        component_fields = (
            "basic_salary",
            "housing_allowance",
            "transportation_allowance",
            "other_allowance",
        )
        if "total_salary_package" not in attrs and not self.instance:
            attrs["total_salary_package"] = sum((attrs.get(field) or Decimal("0")) for field in component_fields)

        hiring_request = attrs.get("hiring_request", getattr(self.instance, "hiring_request", None))
        if hiring_request:
            reference_errors = {}
            if not attrs.get("department_ref", getattr(self.instance, "department_ref", None)):
                reference_errors["department_id"] = ["This field is required for hiring-request job offers."]
            if not attrs.get("position_ref", getattr(self.instance, "position_ref", None)):
                reference_errors["position_id"] = ["This field is required for hiring-request job offers."]
            if reference_errors:
                raise serializers.ValidationError(reference_errors)
        elif not self.instance and not attrs.get("position_title"):
            raise serializers.ValidationError({"position_title": ["This field is required."]})
        return attrs

    @staticmethod
    def _sync_reference_names(validated_data, instance=None):
        linked_offer = bool(instance and instance.hiring_request_id)
        department = validated_data.get("department_ref", instance.department_ref if linked_offer else None)
        position = validated_data.get("position_ref", instance.position_ref if linked_offer else None)
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


class HiringRequestSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    requested_by_id = serializers.IntegerField(read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    ceo_decision_by_id = serializers.IntegerField(read_only=True)
    ceo_decision_by_name = serializers.SerializerMethodField()
    job_offer_id = serializers.SerializerMethodField()
    has_cv = serializers.SerializerMethodField()
    cv_download_url = serializers.SerializerMethodField()
    workflow = serializers.SerializerMethodField()

    class Meta:
        model = HiringRequest
        fields = [
            "id",
            "company_id",
            "company_name",
            "reference_number",
            "candidate_full_name",
            "candidate_email",
            "candidate_phone_number",
            "nationality",
            "date_of_birth",
            "proposed_salary",
            "cv_file",
            "has_cv",
            "cv_download_url",
            "status",
            "status_label",
            "requested_by_id",
            "requested_by_name",
            "submitted_at",
            "ceo_decision_by_id",
            "ceo_decision_by_name",
            "ceo_decision_at",
            "ceo_decision_note",
            "job_offer_id",
            "workflow",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "reference_number",
            "status",
            "requested_by_id",
            "submitted_at",
            "ceo_decision_by_id",
            "ceo_decision_at",
            "ceo_decision_note",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {"cv_file": {"write_only": True}}

    def get_requested_by_name(self, obj: HiringRequest) -> str:
        return (obj.requested_by.full_name or obj.requested_by.email or "").strip()

    def get_ceo_decision_by_name(self, obj: HiringRequest) -> str | None:
        user = obj.ceo_decision_by
        return (user.full_name or user.email or "").strip() if user else None

    def get_job_offer_id(self, obj: HiringRequest) -> int | None:
        try:
            return obj.job_offer.id
        except JobOffer.DoesNotExist:
            return None

    def get_has_cv(self, obj: HiringRequest) -> bool:
        return bool(obj.cv_file)

    def get_cv_download_url(self, obj: HiringRequest) -> str | None:
        if not obj.cv_file:
            return None
        request = self.context.get("request")
        path = f"/hiring-requests/{obj.id}/cv/"
        return request.build_absolute_uri(path) if request else path

    def get_workflow(self, obj: HiringRequest) -> dict:
        request = self.context.get("request")
        actor = request.user if request else None
        snapshot = get_workflow_snapshot(obj, actor=actor)
        is_hr = bool(actor and get_role(actor) in {"HRManager", "SystemAdmin"})
        is_draft = obj.status == HiringRequest.Status.DRAFT
        snapshot["can_edit"] = is_hr and is_draft
        snapshot["can_submit"] = is_hr and is_draft
        snapshot["can_cancel"] = is_hr and obj.status in {
            HiringRequest.Status.DRAFT,
            HiringRequest.Status.SUBMITTED,
        }
        return snapshot

    def validate_candidate_phone_number(self, value: str) -> str:
        if not value:
            return ""
        normalized = normalize_phone_number(value)
        if not normalized or not is_e164(normalized):
            raise serializers.ValidationError("Phone number must be in E.164 format.")
        return normalized

    def validate_proposed_salary(self, value: Decimal) -> Decimal:
        if value < 0:
            raise serializers.ValidationError("Amount cannot be negative.")
        return value

    def validate_cv_file(self, value):
        return validate_hiring_request_cv(value)


class HiringRequestDecisionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")


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
