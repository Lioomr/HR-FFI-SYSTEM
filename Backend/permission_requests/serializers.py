from django.utils import timezone
from rest_framework import serializers

from core.pdf_signers import display_name
from core.services import get_workflow_snapshot_read_only, get_workflow_snapshots
from employees.services.manager_relationships import get_valid_direct_manager_profile

from .labels import EXIT_TYPE_LABELS, STATUS_LABELS, profile_department, profile_employee_number, profile_job_title
from .models import MAX_DURATION_MINUTES, PENDING_STATUSES, REASON_MAX_LENGTH, PermissionRequest
from .permissions import is_hr_approver_user
from .services import can_actor_decide

#: Fields the server assigns. Submitting any of them is refused rather than ignored,
#: so a client can never believe it chose the owner, company, or outcome.
SERVER_ASSIGNED_FIELDS = frozenset(
    {
        "id",
        "employee",
        "employee_id",
        "employee_profile",
        "employee_profile_id",
        "company",
        "company_id",
        "status",
        "reference_no",
        "manager_decision",
        "manager_decision_by",
        "manager_decision_at",
        "manager_decision_note",
        "hr_decision",
        "hr_decision_by",
        "hr_decision_at",
        "hr_decision_note",
        "cancelled_at",
        "created_at",
        "updated_at",
    }
)
SERVER_ASSIGNED_MESSAGE = "This field is assigned by the server and cannot be submitted."


def _minutes(value) -> int:
    return value.hour * 60 + value.minute


class PermissionRequestCreateSerializer(serializers.Serializer):
    request_date = serializers.DateField()
    from_time = serializers.TimeField()
    to_time = serializers.TimeField()
    exit_type = serializers.ChoiceField(choices=PermissionRequest.ExitType.choices)
    reason = serializers.CharField(max_length=REASON_MAX_LENGTH)
    # Optional echo from the client; the stored value is always calculated here.
    duration_minutes = serializers.IntegerField(required=False, allow_null=True, write_only=True)

    def to_internal_value(self, data):
        if hasattr(data, "keys"):
            forged = sorted(key for key in data.keys() if key in SERVER_ASSIGNED_FIELDS)
            if forged:
                raise serializers.ValidationError({key: [SERVER_ASSIGNED_MESSAGE] for key in forged})
        return super().to_internal_value(data)

    def validate_request_date(self, value):
        # timezone.localdate() uses the configured company time zone (APP_TIME_ZONE),
        # never the client's clock.
        today = timezone.localdate()
        if value != today:
            raise serializers.ValidationError(
                f"Permission requests can only be submitted for the current workday ({today.isoformat()})."
            )
        return value

    @staticmethod
    def _minute_precision(value):
        if value.second or value.microsecond:
            raise serializers.ValidationError("Times must be given in hours and minutes only.")
        return value

    def validate_from_time(self, value):
        return self._minute_precision(value)

    def validate_to_time(self, value):
        return self._minute_precision(value)

    def validate(self, attrs):
        duration = _minutes(attrs["to_time"]) - _minutes(attrs["from_time"])
        if duration <= 0:
            raise serializers.ValidationError({"to_time": ["End time must be later than start time on the same day."]})
        if duration > MAX_DURATION_MINUTES:
            raise serializers.ValidationError(
                {"to_time": [f"A permission request cannot exceed {MAX_DURATION_MINUTES} minutes."]}
            )
        supplied = attrs.pop("duration_minutes", None)
        if supplied is not None and supplied != duration:
            raise serializers.ValidationError(
                {"duration_minutes": ["duration_minutes is calculated by the server and does not match the times."]}
            )
        attrs["duration_minutes"] = duration
        return attrs


class PermissionRequestDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=REASON_MAX_LENGTH)


def _user_summary(user):
    if user is None:
        return None
    return {"id": user.pk, "email": user.email, "full_name": display_name(user=user)}


class PermissionRequestListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        instances = list(data)
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        self.child._workflow_snapshot_cache = get_workflow_snapshots(instances, actor=actor)
        try:
            return super().to_representation(instances)
        finally:
            self.child._workflow_snapshot_cache = None


READ_FIELDS = [
    "id",
    "reference_no",
    "request_date",
    "from_time",
    "to_time",
    "duration_minutes",
    "exit_type",
    "exit_type_label",
    "exit_type_label_ar",
    "reason",
    "status",
    "status_label",
    "status_label_ar",
    "employee",
    "company_id",
    "company_name",
    "manager_decision",
    "manager_decision_by",
    "manager_decision_at",
    "manager_decision_note",
    "hr_decision",
    "hr_decision_by",
    "hr_decision_at",
    "hr_decision_note",
    "cancelled_at",
    "created_at",
    "updated_at",
    "workflow",
]


class PermissionRequestReadSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    status_label = serializers.SerializerMethodField()
    status_label_ar = serializers.SerializerMethodField()
    exit_type_label = serializers.SerializerMethodField()
    exit_type_label_ar = serializers.SerializerMethodField()
    manager_decision_by = serializers.SerializerMethodField()
    hr_decision_by = serializers.SerializerMethodField()
    workflow = serializers.SerializerMethodField()

    class Meta:
        model = PermissionRequest
        list_serializer_class = PermissionRequestListSerializer
        fields = READ_FIELDS
        read_only_fields = READ_FIELDS

    def get_employee(self, obj):
        profile = obj.employee_profile
        return {
            "id": obj.employee_id,
            "email": obj.employee.email,
            "full_name": display_name(user=obj.employee, profile=profile),
            "full_name_ar": profile.full_name_ar or "",
            "employee_profile_id": profile.pk,
            "employee_number": profile_employee_number(profile),
            "department": profile_department(profile),
            "job_title": profile_job_title(profile),
        }

    def get_status_label(self, obj):
        return STATUS_LABELS.get(obj.status, (obj.status, obj.status))[0]

    def get_status_label_ar(self, obj):
        return STATUS_LABELS.get(obj.status, (obj.status, obj.status))[1]

    def get_exit_type_label(self, obj):
        return EXIT_TYPE_LABELS.get(obj.exit_type, (obj.exit_type, obj.exit_type))[0]

    def get_exit_type_label_ar(self, obj):
        return EXIT_TYPE_LABELS.get(obj.exit_type, (obj.exit_type, obj.exit_type))[1]

    def get_manager_decision_by(self, obj):
        return _user_summary(obj.manager_decision_by)

    def get_hr_decision_by(self, obj):
        return _user_summary(obj.hr_decision_by)

    def _actor(self):
        request = self.context.get("request")
        return getattr(request, "user", None) if request else None

    def _is_hr_approver(self, actor):
        cache = self.context.setdefault("_permission_request_hr_approver", {})
        if actor.pk not in cache:
            cache[actor.pk] = is_hr_approver_user(actor)
        return cache[actor.pk]

    def get_workflow(self, obj):
        actor = self._actor()
        cache = getattr(self, "_workflow_snapshot_cache", None)
        snapshot = cache.get(obj.pk) if cache else None
        if snapshot is None:
            snapshot = get_workflow_snapshot_read_only(obj, actor=actor)
        snapshot = dict(snapshot)
        # The engine answers "is this user an approver for the stage". The decision
        # endpoints also refuse self-approval and re-check the manager relationship,
        # so the flags are recomputed to mirror exactly what the API will accept.
        can_decide = can_actor_decide(actor, obj, is_hr_approver=self._is_hr_approver)
        snapshot["can_approve"] = can_decide
        snapshot["can_reject"] = can_decide
        snapshot["can_cancel"] = bool(
            actor and actor.is_authenticated and actor.pk == obj.employee_id and obj.status in PENDING_STATUSES
        )
        return snapshot


class PermissionRequestDetailSerializer(PermissionRequestReadSerializer):
    direct_manager = serializers.SerializerMethodField()

    class Meta(PermissionRequestReadSerializer.Meta):
        fields = [*READ_FIELDS, "direct_manager"]
        read_only_fields = fields

    def get_direct_manager(self, obj):
        manager_profile = get_valid_direct_manager_profile(obj.employee_profile)
        if manager_profile is None:
            return None
        return {
            "id": manager_profile.user_id,
            "employee_profile_id": manager_profile.pk,
            "full_name": display_name(profile=manager_profile),
        }
