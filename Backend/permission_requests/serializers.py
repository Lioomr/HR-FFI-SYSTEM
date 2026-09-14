import json
from collections.abc import Mapping
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from admin_portal.models import SystemSettings
from core.pdf_signers import display_name
from core.services import get_workflow_snapshot_read_only, get_workflow_snapshots
from employees.services.manager_relationships import get_valid_direct_manager_profile

from .labels import EXIT_TYPE_LABELS, STATUS_LABELS, profile_department, profile_employee_number, profile_job_title
from .models import PENDING_STATUSES, REASON_MAX_LENGTH, PermissionRequest, PermissionRequestAttachment
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


class CaptureMetadataListField(serializers.ListField):
    """Per-file capture metadata, aligned with ``attachments``.

    Multipart clients send each entry as a JSON-text part and JSON clients send
    objects. Both are stored as objects, so ``capture_metadata`` always reads back
    as an object rather than the text a multipart client posted.
    """

    default_error_messages = {"invalid_item": "Each attachment_metadata entry must be a JSON object."}

    def to_internal_value(self, data):
        if isinstance(data, (str, bytes, Mapping)) or not hasattr(data, "__iter__"):
            self.fail("not_a_list", input_type=type(data).__name__)
        entries = []
        for item in data:
            if isinstance(item, bytes):
                item = item.decode()
            if isinstance(item, str):
                try:
                    item = json.loads(item)
                except ValueError:
                    self.fail("invalid_item")
            if not isinstance(item, dict):
                self.fail("invalid_item")
            entries.append(item)
        return entries


class PermissionRequestCreateSerializer(serializers.Serializer):
    request_date = serializers.DateField()
    permission_type = serializers.ChoiceField(choices=PermissionRequest.PermissionType.choices, required=False)
    from_time = serializers.TimeField(required=False)
    to_time = serializers.TimeField(required=False)
    exit_type = serializers.ChoiceField(choices=PermissionRequest.ExitType.choices, required=False)
    reason = serializers.CharField(max_length=REASON_MAX_LENGTH)
    # Optional echo from the client; the stored value is always calculated here.
    duration_minutes = serializers.IntegerField(required=False, allow_null=True, write_only=True)
    attachments = serializers.ListField(child=serializers.FileField(), required=False, write_only=True)
    attachment_metadata = CaptureMetadataListField(required=False, write_only=True)

    def to_internal_value(self, data):
        if hasattr(data, "keys"):
            forged = sorted(key for key in data.keys() if key in SERVER_ASSIGNED_FIELDS)
            if forged:
                raise serializers.ValidationError({key: [SERVER_ASSIGNED_MESSAGE] for key in forged})
        return super().to_internal_value(data)

    @staticmethod
    def _minute_precision(value):
        if value.second or value.microsecond:
            raise serializers.ValidationError("Times must be given in hours and minutes only.")
        return value

    def validate_from_time(self, value):
        return self._minute_precision(value)

    def validate_to_time(self, value):
        return self._minute_precision(value)

    @staticmethod
    def _validate_attachment(value):
        max_size = int(getattr(settings, "MAX_PERMISSION_REQUEST_ATTACHMENT_SIZE_BYTES", 10 * 1024 * 1024))
        content_type = (getattr(value, "content_type", "") or "").lower()
        allowed = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
        if content_type not in allowed:
            raise serializers.ValidationError("Evidence must be a PDF or supported image file.")
        if value.size > max_size:
            raise serializers.ValidationError(
                f"Evidence file is too large. Maximum size is {max_size // (1024 * 1024)} MB."
            )
        return value

    def validate_attachments(self, values):
        return [self._validate_attachment(value) for value in values]

    def validate(self, attrs):
        permission_type = attrs.setdefault("permission_type", PermissionRequest.PermissionType.EXIT)
        today = timezone.localdate()
        request_date = attrs["request_date"]
        policy = SystemSettings.get_solo()
        if permission_type == PermissionRequest.PermissionType.EXIT:
            if request_date != today:
                raise serializers.ValidationError(
                    {
                        "request_date": [
                            f"Permission requests can only be submitted for the current workday ({today.isoformat()})."
                        ]
                    }
                )
        elif request_date < today or request_date > today + timedelta(
            days=policy.permission_request_advance_limit_days
        ):
            raise serializers.ValidationError(
                {
                    "request_date": [
                        f"{permission_type.replace('_', ' ').title()} Permissions may be submitted from today through "
                        f"{policy.permission_request_advance_limit_days} calendar days ahead."
                    ]
                }
            )

        supplied = attrs.pop("duration_minutes", None)
        attachments = attrs.get("attachments", [])
        metadata = attrs.get("attachment_metadata", [])
        if metadata and len(metadata) != len(attachments):
            raise serializers.ValidationError({"attachment_metadata": ["Provide metadata for each attachment."]})

        if permission_type == PermissionRequest.PermissionType.LATE:
            supplied_time_fields = set(self.initial_data).intersection(
                {"from_time", "to_time", "duration_minutes", "exit_type"}
            )
            if supplied_time_fields:
                raise serializers.ValidationError(
                    {
                        field: ["Late Permission does not accept employee-entered time or exit type."]
                        for field in supplied_time_fields
                    }
                )
            if not attachments:
                raise serializers.ValidationError(
                    {"attachments": ["Late Permission requires at least one evidence attachment."]}
                )
            attrs["from_time"] = None
            attrs["to_time"] = None
            attrs["duration_minutes"] = 0
            attrs["exit_type"] = ""
            return attrs

        required = {"from_time", "to_time"}
        missing = sorted(field for field in required if field not in attrs)
        if missing:
            raise serializers.ValidationError(
                {field: ["This field is required for this permission type."] for field in missing}
            )
        if permission_type == PermissionRequest.PermissionType.EXIT and "exit_type" not in attrs:
            raise serializers.ValidationError({"exit_type": ["This field is required for Exit Permission."]})

        duration = _minutes(attrs["to_time"]) - _minutes(attrs["from_time"])
        if duration <= 0:
            raise serializers.ValidationError({"to_time": ["End time must be later than start time on the same day."]})
        maximum = (
            120
            if permission_type == PermissionRequest.PermissionType.EXIT
            else policy.during_shift_permission_max_minutes
        )
        if duration > maximum:
            raise serializers.ValidationError({"to_time": [f"A permission request cannot exceed {maximum} minutes."]})
        if supplied is not None and supplied != duration:
            raise serializers.ValidationError(
                {"duration_minutes": ["duration_minutes is calculated by the server and does not match the times."]}
            )
        attrs["duration_minutes"] = duration
        attrs.setdefault("exit_type", "")
        return attrs


class PermissionRequestDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=REASON_MAX_LENGTH)


class PermissionRequestAttachmentCreateSerializer(serializers.Serializer):
    attachments = serializers.ListField(child=serializers.FileField(), min_length=1, allow_empty=False)
    attachment_metadata = CaptureMetadataListField(required=False)

    def validate_attachments(self, values):
        return [PermissionRequestCreateSerializer._validate_attachment(value) for value in values]

    def validate(self, attrs):
        metadata = attrs.get("attachment_metadata", [])
        if metadata and len(metadata) != len(attrs["attachments"]):
            raise serializers.ValidationError({"attachment_metadata": ["Provide metadata for each attachment."]})
        return attrs


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
    "permission_type",
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
    "attachments",
    "attachment_count",
    "monthly_late_permission_usage",
    "monthly_late_permission_limit",
    "workflow",
]


class PermissionRequestAttachmentReadSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = PermissionRequestAttachment
        fields = [
            "id",
            "original_filename",
            "content_type",
            "size_bytes",
            "capture_metadata",
            "created_at",
            "download_url",
        ]

    def get_download_url(self, obj):
        return f"/api/permission-requests/{obj.permission_request_id}/attachments/{obj.pk}/download/"


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
    attachments = PermissionRequestAttachmentReadSerializer(many=True, read_only=True)
    attachment_count = serializers.SerializerMethodField()
    monthly_late_permission_usage = serializers.SerializerMethodField()
    monthly_late_permission_limit = serializers.SerializerMethodField()

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

    def get_attachment_count(self, obj):
        return len(obj.attachments.all())

    def get_monthly_late_permission_usage(self, obj):
        if obj.permission_type != PermissionRequest.PermissionType.LATE:
            return None
        from .services import approved_late_permission_usage

        return approved_late_permission_usage(obj.employee_id, obj.request_date)

    def get_monthly_late_permission_limit(self, obj):
        if obj.permission_type != PermissionRequest.PermissionType.LATE:
            return None
        return SystemSettings.get_solo().approved_late_permission_limit_per_month

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
