from datetime import timedelta
from decimal import ROUND_FLOOR, Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from core.permissions import get_role
from core.services import (
    get_obligations_summaries,
    get_obligations_summary,
    get_workflow_snapshot_read_only,
    get_workflow_snapshots,
)
from employees.models import EmployeeProfile

from .models import AnnualLeavePaymentRequest, LeaveBalanceAdjustment, LeaveRequest, LeaveType
from .utils import (
    ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON,
    PENDING_RESERVATION_STATUSES,
    build_annual_leave_payment_snapshot,
    get_contract_year_cycle,
    get_leave_days,
    get_leave_request_payment_context,
    get_payment_breakdown,
    get_used_days_for_type,
    has_active_annual_leave_settlement,
    has_pending_annual_leave,
    leave_request_employee_filter,
    resolve_employee_profile,
    validate_leave_request_policy,
)

User = get_user_model()
LEAVE_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
LEAVE_MAX_UPLOAD_SIZE = int(getattr(settings, "MAX_LEAVE_DOCUMENT_SIZE_BYTES", 5 * 1024 * 1024))
EMPLOYEE_LEAVE_BACKDATE_DAYS = 7


def delegation_user_queryset():
    return User.objects.filter(
        is_active=True,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        employee_profile__is_archived=False,
        employee_profile__company__is_active=True,
    )


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]


class LeaveTypeSerializer(serializers.ModelSerializer):
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = LeaveType
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at"]


class LeaveBalanceSerializer(serializers.Serializer):
    leave_type_id = serializers.IntegerField()
    leave_type = serializers.CharField()
    leave_code = serializers.CharField(required=False)
    available_annual_year_days = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    total_days = serializers.DecimalField(max_digits=10, decimal_places=2)
    used_days = serializers.DecimalField(max_digits=10, decimal_places=2)
    remaining_days = serializers.DecimalField(max_digits=10, decimal_places=2)
    pending_days = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    requestable_days = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    fractional_days = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)


class LeaveRequestListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        instances = list(data)
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        self.child._workflow_snapshot_cache = get_workflow_snapshots(instances, actor=actor)
        self.child._obligations_summary_cache = get_obligations_summaries(instances)
        self.child._payment_context_cache = get_leave_request_payment_context(instances)
        try:
            return super().to_representation(instances)
        finally:
            self.child._workflow_snapshot_cache = None
            self.child._obligations_summary_cache = None
            self.child._payment_context_cache = None


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    leave_type = LeaveTypeSerializer(read_only=True)
    decided_by = UserSummarySerializer(read_only=True)
    delegated_to = UserSummarySerializer(read_only=True)
    days = serializers.SerializerMethodField()
    payment_breakdown = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    deducted_from_leave_type = serializers.SerializerMethodField()
    workflow = serializers.SerializerMethodField()
    obligations_summary = serializers.SerializerMethodField()
    requires_hr_completion_visa = serializers.SerializerMethodField()
    employee_documents = serializers.SerializerMethodField()
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = "__all__"
        read_only_fields = [
            "employee",
            "status",
            "decided_by",
            "decided_at",
            "decision_reason",
            "created_at",
            "updated_at",
        ]
        list_serializer_class = LeaveRequestListSerializer

    def get_days(self, obj):
        return get_leave_days(obj.start_date, obj.end_date)

    def get_employee(self, obj):
        if obj.employee:
            return UserSummarySerializer(obj.employee).data

        profile = obj.employee_profile
        if not profile:
            profile = resolve_employee_profile(obj.employee)
        if not profile:
            return None

        return {
            "id": None,
            "email": "",
            "full_name": profile.full_name or profile.full_name_en or profile.employee_id,
        }

    def get_payment_breakdown(self, obj):
        payment_cache = getattr(self, "_payment_context_cache", None)
        if payment_cache is not None and obj.pk in payment_cache:
            return payment_cache[obj.pk]["breakdown"]
        year = obj.start_date.year
        employee_subject = obj.employee_profile or obj.employee
        current_days = get_leave_days(obj.start_date, obj.end_date)
        used_total = get_used_days_for_type(employee_subject, obj.leave_type, year)
        if obj.status == LeaveRequest.RequestStatus.APPROVED:
            used_before = max(0.0, used_total - current_days)
        else:
            used_before = used_total
        return get_payment_breakdown(
            obj.leave_type,
            used_before,
            current_days,
            employee_subject=employee_subject,
            year=year,
        )

    def get_payment_status(self, obj):
        breakdown = self.get_payment_breakdown(obj)
        if not breakdown:
            return "unknown"
        percents = {b["pay_percent"] for b in breakdown}
        if percents == {100}:
            return "full_pay"
        if percents == {0}:
            return "unpaid"
        if percents == {70}:
            return "partial_pay_70"
        if percents == {50}:
            return "half_pay"
        return "mixed"

    def get_deducted_from_leave_type(self, obj):
        code = (obj.leave_type.code or obj.leave_type.name or "").strip().upper().replace(" ", "_")
        if code in {"EMERGENCY", "EMERGENCY_LEAVE"}:
            return "ANNUAL"
        return code

    def get_workflow(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        cache = getattr(self, "_workflow_snapshot_cache", None)
        if cache is not None and obj.pk in cache:
            return cache[obj.pk]
        return get_workflow_snapshot_read_only(obj, actor=actor)

    def get_obligations_summary(self, obj):
        cache = getattr(self, "_obligations_summary_cache", None)
        if cache is not None and obj.pk in cache:
            return cache[obj.pk]
        return get_obligations_summary(obj)

    def get_requires_hr_completion_visa(self, obj):
        profile = obj.employee_profile or resolve_employee_profile(obj.employee)
        return bool(profile and not profile.is_saudi and obj.status == LeaveRequest.RequestStatus.PENDING_HR_COMPLETION)

    def get_employee_documents(self, obj):
        from employees.serializers import EmployeeDocumentSerializer

        documents = getattr(obj, "_prefetched_objects_cache", {}).get("employee_documents")
        if documents is None:
            documents = obj.employee_documents.select_related("uploaded_by", "company", "leave_request")
        return EmployeeDocumentSerializer(documents, many=True, context=self.context).data


class LeaveRequestCreateSerializer(serializers.ModelSerializer):
    delegated_to = serializers.PrimaryKeyRelatedField(
        queryset=delegation_user_queryset(), allow_null=True, required=False
    )

    class Meta:
        model = LeaveRequest
        fields = [
            "leave_type",
            "start_date",
            "end_date",
            "reason",
            "document",
            "other_leave_description",
            "date_of_rejoin",
            "po_box",
            "full_address",
            "airplane_ticket_payer",
            "airplane_ticket_address",
            "delegated_to",
            "delegation_note",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        qs = delegation_user_queryset()
        if request and getattr(request, "user", None) and request.user.is_authenticated:
            from organization.services import get_active_company_for_request

            active_company = get_active_company_for_request(request)
            self.fields["leave_type"].queryset = LeaveType.objects.filter(
                company=active_company,
                is_active=True,
            )
            qs = qs.filter(employee_profile__company=active_company)
            qs = qs.exclude(id=request.user.id)
        self.fields["delegated_to"].queryset = qs

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        leave_type = attrs.get("leave_type")
        reason = attrs.get("reason", "")
        document = attrs.get("document")
        delegated_to = attrs.get("delegated_to")
        user = self.context["request"].user
        profile = EmployeeProfile.objects.filter(user=user).first()
        if not profile or profile.is_archived or not profile.company_id:
            raise serializers.ValidationError("Archived employees cannot create leave requests.")

        from organization.services import get_active_company_for_request

        active_company = get_active_company_for_request(self.context["request"])
        if not active_company or profile.company_id != active_company.id:
            raise serializers.ValidationError("Employee does not belong to the active company.")
        if leave_type and leave_type.company_id != profile.company_id:
            raise serializers.ValidationError({"leave_type": "Leave type must belong to the employee's company."})
        delegated_profile = getattr(delegated_to, "employee_profile", None) if delegated_to else None
        if delegated_profile and delegated_profile.company_id != profile.company_id:
            raise serializers.ValidationError({"delegated_to": "Delegate must belong to the employee's company."})

        if delegated_to and delegated_to.id == user.id:
            raise serializers.ValidationError(
                {"delegated_to": "You cannot delegate your own leave request to yourself."}
            )

        if start and end:
            if start > end:
                raise serializers.ValidationError({"end_date": "End date must be after start date."})

            earliest_start_date = timezone.localdate() - timedelta(days=EMPLOYEE_LEAVE_BACKDATE_DAYS)
            if start < earliest_start_date:
                raise serializers.ValidationError(
                    {"start_date": "Leave can be submitted up to 7 calendar days after it starts."}
                )

        if leave_type and not leave_type.is_active:
            raise serializers.ValidationError({"leave_type": "Leave type is inactive."})

        leave_code = (leave_type.code or leave_type.name or "").strip().upper().replace(" ", "_")
        if leave_code in {"SICK", "SICK_LEAVE"} and not document:
            raise serializers.ValidationError({"document": "Medical report document is required for sick leave."})

        # Overlap Check
        # Check against APPROVED or PENDING requests across all companies —
        # an employee is one person and cannot take overlapping leave regardless
        # of which company the leave is assigned to.
        overlap_qs = LeaveRequest.objects.filter(
            employee=user,
            is_active=True,
            status__in=[
                LeaveRequest.RequestStatus.APPROVED,
                LeaveRequest.RequestStatus.SUBMITTED,
                LeaveRequest.RequestStatus.PENDING_DELEGATE,
                LeaveRequest.RequestStatus.PENDING_MANAGER,
                LeaveRequest.RequestStatus.PENDING_HR,
            ],
        ).filter(
            # (start <= req.end) AND (end >= req.start)
            Q(start_date__lte=end) & Q(end_date__gte=start)
        )

        if overlap_qs.exists():
            raise serializers.ValidationError("You already have a pending or approved leave request for this period.")

        policy_error = validate_leave_request_policy(user, leave_type, start, end, reason, bool(document))
        if policy_error:
            raise serializers.ValidationError(policy_error)

        return attrs

    def validate_document(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension not in LEAVE_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError("Unsupported file type.")
        if value.size > LEAVE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value


class LeaveRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
    waiver_reason = serializers.CharField(required=False, allow_blank=True)


class LeaveRequestCompleteSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
    visa_document = serializers.FileField(required=False, allow_null=True)

    def validate_visa_document(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension != ".pdf":
            raise serializers.ValidationError("Visa document must be a PDF.")
        if value.size > LEAVE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value


class LeaveRequestDelegationSerializer(serializers.Serializer):
    delegated_to = serializers.PrimaryKeyRelatedField(queryset=delegation_user_queryset())
    delegation_note = serializers.CharField(required=False, allow_blank=True)


class HRManualLeaveRequestSerializer(serializers.ModelSerializer):
    employee_id = serializers.IntegerField(write_only=True)
    warning_messages = serializers.ListField(child=serializers.CharField(), read_only=True)
    delegated_to = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), allow_null=True, required=False)

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "employee_id",
            "leave_type",
            "start_date",
            "end_date",
            "reason",
            "document",
            "manual_entry_reason",
            "source_document_ref",
            "warning_messages",
            "other_leave_description",
            "date_of_rejoin",
            "po_box",
            "full_address",
            "airplane_ticket_payer",
            "airplane_ticket_address",
            "delegated_to",
            "delegation_note",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        from organization.services import get_active_company_for_request

        company = get_active_company_for_request(request) if request else None
        self.fields["delegated_to"].queryset = delegation_user_queryset().filter(employee_profile__company=company)
        self.fields["leave_type"].queryset = LeaveType.objects.filter(company=company, is_active=True)
        self._active_company = company

    @property
    def policy_warnings(self):
        return getattr(self, "_policy_warnings", [])

    def _get_employee_profile(self, employee_profile_id):
        try:
            profile = EmployeeProfile.objects.select_related("user").get(
                id=employee_profile_id,
                company=self._active_company,
            )
        except EmployeeProfile.DoesNotExist as exc:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."}) from exc

        if profile.is_archived or profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
            raise serializers.ValidationError({"employee_id": "Only active employees are allowed."})

        return profile

    def validate_manual_entry_reason(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("manual_entry_reason is required.")
        return value

    def validate_source_document_ref(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("source_document_ref is required.")
        return value

    def validate(self, attrs):
        employee_id = attrs.get("employee_id")
        if employee_id is None:
            if self.instance is None:
                raise serializers.ValidationError({"employee_id": "employee_id is required."})
            employee_profile = self.instance.employee_profile or resolve_employee_profile(self.instance.employee)
        else:
            employee_profile = self._get_employee_profile(employee_id)

        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        leave_type = attrs.get("leave_type", getattr(self.instance, "leave_type", None))
        reason = attrs.get("reason", getattr(self.instance, "reason", ""))
        document = attrs.get("document", getattr(self.instance, "document", None))
        delegated_to = attrs.get("delegated_to", getattr(self.instance, "delegated_to", None))

        if delegated_to and employee_profile.user_id and delegated_to.id == employee_profile.user_id:
            raise serializers.ValidationError(
                {"delegated_to": "You cannot delegate a leave request to the same employee."}
            )

        if start and end and start > end:
            raise serializers.ValidationError({"end_date": "End date must be after start date."})

        if leave_type and not leave_type.is_active:
            raise serializers.ValidationError({"leave_type": "Leave type is inactive."})
        if leave_type and leave_type.company_id != employee_profile.company_id:
            raise serializers.ValidationError({"leave_type": "Leave type must belong to the employee's company."})
        delegated_profile = getattr(delegated_to, "employee_profile", None) if delegated_to else None
        if delegated_profile and delegated_profile.company_id != employee_profile.company_id:
            raise serializers.ValidationError({"delegated_to": "Delegate must belong to the employee's company."})

        leave_code = (leave_type.code or leave_type.name or "").strip().upper().replace(" ", "_")
        if leave_code in {"SICK", "SICK_LEAVE"} and not document and not getattr(self.instance, "document", None):
            raise serializers.ValidationError({"document": "Medical report document is required for sick leave."})

        policy_error = validate_leave_request_policy(employee_profile, leave_type, start, end, reason, bool(document))
        self._policy_warnings = []
        if policy_error:
            normalized = str(policy_error).lower()
            if "exceeds remaining balance" in normalized or "exceeds available balance" in normalized:
                self._policy_warnings.append(policy_error)
            else:
                raise serializers.ValidationError(policy_error)

        attrs["employee_profile_obj"] = employee_profile
        return attrs

    def validate_document(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension not in LEAVE_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError("Unsupported file type.")
        if value.size > LEAVE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value

    def create(self, validated_data):
        employee_profile = validated_data.pop("employee_profile_obj")
        validated_data.pop("employee_id", None)
        request_user = self.context["request"].user
        return LeaveRequest.objects.create(
            employee=employee_profile.user,
            employee_profile=employee_profile,
            company=employee_profile.company,
            status=LeaveRequest.RequestStatus.APPROVED,
            source=LeaveRequest.RequestSource.HR_MANUAL,
            entered_by=request_user,
            decided_by=request_user,
            decided_at=timezone.now(),
            policy_warnings=self.policy_warnings,
            **validated_data,
        )

    def update(self, instance, validated_data):
        validated_data.pop("employee_id", None)
        employee_profile = validated_data.pop("employee_profile_obj", None)
        request_user = self.context["request"].user

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if employee_profile is not None:
            instance.employee_profile = employee_profile
            instance.employee = employee_profile.user
            instance.company = employee_profile.company

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.source = LeaveRequest.RequestSource.HR_MANUAL
        instance.decided_by = request_user
        instance.decided_at = timezone.now()
        instance.entered_by = instance.entered_by or request_user
        instance.policy_warnings = self.policy_warnings
        instance.save()
        return instance


class LeaveBalanceAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.ReadOnlyField(source="created_by.full_name")
    employee_id = serializers.IntegerField(write_only=True)
    employee_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = LeaveBalanceAdjustment
        fields = [
            "id",
            "employee",
            "employee_profile",
            "employee_id",
            "employee_name",
            "leave_type",
            "adjustment_days",
            "reason",
            "created_by",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = ["employee", "employee_profile", "employee_name", "created_by", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request:
            from organization.services import get_active_company_for_request

            self._active_company = get_active_company_for_request(request)
            self.fields["leave_type"].queryset = LeaveType.objects.filter(company=self._active_company)
        else:
            self._active_company = None

    def get_employee_name(self, obj):
        if obj.employee:
            return getattr(obj.employee, "full_name", "") or getattr(obj.employee, "email", "") or ""
        profile = obj.employee_profile
        if profile:
            return profile.full_name or profile.full_name_en or profile.employee_id
        return ""

    def create(self, validated_data):
        emp_id = validated_data.pop("employee_id")
        try:
            profile = EmployeeProfile.objects.get(
                id=emp_id,
                is_archived=False,
                company=self._active_company,
            )
        except EmployeeProfile.DoesNotExist:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."})

        leave_type = validated_data.get("leave_type")
        if leave_type and leave_type.company_id != profile.company_id:
            raise serializers.ValidationError({"leave_type": "Leave type must belong to the employee's company."})

        validated_data["employee_profile"] = profile
        validated_data["employee"] = profile.user
        validated_data["company"] = profile.company
        return super().create(validated_data)


class AnnualLeavePaymentRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_id = serializers.IntegerField(source="employee_profile.id", read_only=True)
    fractional_days = serializers.SerializerMethodField()
    has_pending_annual_leave = serializers.SerializerMethodField()

    class Meta:
        model = AnnualLeavePaymentRequest
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "company",
            "cycle_start",
            "cycle_end",
            "accrued_days",
            "used_days",
            "eligible_unused_days",
            "fractional_days",
            "has_pending_annual_leave",
            "salary_at_year_end",
            "payment_amount",
            "carry_forward_days",
            "resolution",
            "status",
            "is_termination_settlement",
            "employee_note",
            "hr_review_note",
            "ceo_decision_note",
            "submitted_by",
            "hr_reviewed_by",
            "ceo_decided_by",
            "submitted_at",
            "hr_reviewed_at",
            "ceo_decided_at",
            "settled_at",
        ]
        read_only_fields = [field for field in fields if field not in {"employee_note"}]

    def get_employee_name(self, obj):
        profile = obj.employee_profile
        return profile.full_name or profile.full_name_en or profile.employee_id

    def get_fractional_days(self, obj):
        eligible = obj.eligible_unused_days
        whole = eligible.quantize(Decimal("1"), rounding=ROUND_FLOOR)
        return (eligible - whole).quantize(Decimal("0.01"))

    def get_has_pending_annual_leave(self, obj):
        return has_pending_annual_leave(obj.employee_profile, company=obj.company)


class AnnualLeaveEligibilitySerializer(serializers.Serializer):
    can_request = serializers.BooleanField()
    window_open = serializers.BooleanField()
    cycle_start = serializers.DateField(allow_null=True)
    cycle_end = serializers.DateField(allow_null=True)
    eligible_unused_days = serializers.DecimalField(max_digits=10, decimal_places=2)
    fractional_days = serializers.DecimalField(max_digits=10, decimal_places=2)
    salary_at_year_end = serializers.DecimalField(max_digits=12, decimal_places=2)
    estimated_payment_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    has_pending_annual_leave = serializers.BooleanField()
    reason = serializers.CharField(allow_blank=True)


class AnnualLeavePaymentRequestCreateSerializer(serializers.Serializer):
    employee_id = serializers.IntegerField(required=False, write_only=True)
    employee_note = serializers.CharField(required=False, allow_blank=True)
    termination_date = serializers.DateField(required=False, write_only=True)
    decision = serializers.ChoiceField(choices=["pay", "carry_forward"], required=False, write_only=True)

    def validate(self, attrs):
        request = self.context["request"]
        actor = request.user
        profile = None
        if attrs.get("employee_id"):
            if get_role(actor) not in {"SystemAdmin", "HRManager"}:
                raise serializers.ValidationError("Only HR can submit a payment request for another employee.")
            profile = EmployeeProfile.objects.select_related("user", "company").filter(id=attrs["employee_id"]).first()
            if profile is None:
                raise serializers.ValidationError({"employee_id": "Employee Profile not found."})
        else:
            profile = EmployeeProfile.objects.select_related("user", "company").filter(user=actor).first()
        if profile is None:
            raise serializers.ValidationError("Employee profile is required.")

        from organization.services import get_active_company_for_request

        active_company = get_active_company_for_request(request)
        if not profile.company_id or not active_company or profile.company_id != active_company.id:
            raise serializers.ValidationError("Employee does not belong to the active company.")

        termination_date = attrs.get("termination_date")
        hr_resolution = (
            bool(attrs.get("employee_id"))
            and get_role(actor) in {"SystemAdmin", "HRManager"}
            and bool(attrs.get("decision"))
        )
        if termination_date and profile.employment_status != EmployeeProfile.EmploymentStatus.TERMINATED:
            raise serializers.ValidationError(
                {"termination_date": "Termination date is only valid for terminated employees."}
            )
        if profile.employment_status == EmployeeProfile.EmploymentStatus.TERMINATED and not termination_date:
            termination_date = profile.archived_at.date() if profile.archived_at else timezone.localdate()

        today = timezone.localdate()
        settlement_date = termination_date or today
        if hr_resolution and profile.employment_status != EmployeeProfile.EmploymentStatus.TERMINATED:
            previous_start, previous_end = get_contract_year_cycle(profile, today - timedelta(days=1))
            if previous_end and previous_end < today:
                settlement_date = previous_end
        cycle_start, cycle_end = get_contract_year_cycle(profile, settlement_date)
        if not cycle_start:
            raise serializers.ValidationError("Employee contract date is required for annual leave payment.")
        if not hr_resolution and profile.employment_status != EmployeeProfile.EmploymentStatus.TERMINATED:
            final_window_start = cycle_end - timedelta(days=4)
            if not (final_window_start <= today <= cycle_end):
                raise serializers.ValidationError(
                    "Annual leave payment requests are allowed only in the final 5 days of the contract year."
                )

        if has_active_annual_leave_settlement(profile, cycle_start, company=active_company):
            raise serializers.ValidationError(ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON)

        pending = leave_request_employee_filter(profile)
        annual_type_ids = LeaveType.objects.filter(
            Q(code__iexact="ANNUAL") | Q(code__iexact="ANNUAL_LEAVE"),
            company_id=profile.company_id,
        ).values_list("id", flat=True)
        if (
            pending
            and pending.filter(
                is_active=True,
                leave_type_id__in=annual_type_ids,
                status__in=PENDING_RESERVATION_STATUSES,
            ).exists()
        ):
            raise serializers.ValidationError(
                "Annual leave payment cannot be requested while leave requests are pending."
            )

        snapshot = build_annual_leave_payment_snapshot(
            profile,
            as_of=settlement_date,
            termination_date=termination_date,
        )
        if not snapshot or snapshot["eligible_unused_days"] <= 0:
            raise serializers.ValidationError("There are no eligible whole Annual Leave days available for payment.")

        attrs["profile"] = profile
        attrs["snapshot"] = snapshot
        attrs["is_termination_settlement"] = bool(termination_date)
        attrs["resolution"] = attrs.get("decision", "pay")
        attrs["hr_resolution"] = hr_resolution
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        profile = validated_data.pop("profile")
        snapshot = validated_data.pop("snapshot")
        validated_data.pop("employee_id", None)
        validated_data.pop("termination_date", None)
        validated_data.pop("decision", None)
        resolution = validated_data.pop("resolution")
        hr_resolution = validated_data.pop("hr_resolution")
        return AnnualLeavePaymentRequest.objects.create(
            employee=profile.user,
            employee_profile=profile,
            company=profile.company,
            status=(
                AnnualLeavePaymentRequest.Status.PENDING_CEO
                if hr_resolution
                else AnnualLeavePaymentRequest.Status.PENDING_HR
            ),
            resolution=resolution,
            submitted_by=request.user,
            hr_reviewed_by=request.user if hr_resolution else None,
            hr_reviewed_at=timezone.now() if hr_resolution else None,
            hr_review_note="HR settlement decision" if hr_resolution else "",
            cycle_start=snapshot["cycle_start"],
            cycle_end=snapshot["cycle_end"],
            accrued_days=snapshot["accrued_days"],
            used_days=snapshot["used_days"],
            eligible_unused_days=snapshot["eligible_unused_days"],
            salary_at_year_end=snapshot["salary_at_year_end"],
            payment_amount=(Decimal("0.00") if resolution == "carry_forward" else snapshot["payment_amount"]),
            carry_forward_days=(snapshot["eligible_unused_days"] if resolution == "carry_forward" else Decimal("0.00")),
            is_termination_settlement=validated_data.pop("is_termination_settlement"),
            **validated_data,
        )


class AnnualLeavePaymentReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["forward", "carry_forward"])
    comment = serializers.CharField(required=False, allow_blank=True)
