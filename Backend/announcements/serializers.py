import json
import os

from django.conf import settings
from rest_framework import serializers

from core.permissions import get_role
from employees.models import EmployeeProfile
from organization.services import filter_queryset_by_company_scope, get_active_company_for_request

from .models import Announcement
from .whatsapp_groups import configured_groups


class AnnouncementGroupReadMixin:
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not request or get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            data.pop("whatsapp_group_id", None)
        else:
            group = configured_groups(instance.company).get(instance.whatsapp_group_id)
            data["whatsapp_group_name"] = group["name"] if group else ""
            delivery = getattr(instance, "whatsapp_group_delivery", None)
            data["whatsapp_group_status"] = (
                delivery.status if delivery and delivery.group_id == instance.whatsapp_group_id else ""
            )
        return data


class AnnouncementSerializer(AnnouncementGroupReadMixin, serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    target_user_email = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    attachment_size = serializers.SerializerMethodField()
    has_attachment = serializers.SerializerMethodField()
    publish_to_whatsapp = serializers.BooleanField(source="publish_to_sms", read_only=True)
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "content",
            "announcement_type",
            "whole_company",
            "whatsapp_group_id",
            "target_roles",
            "target_user",
            "target_user_email",
            "publish_to_dashboard",
            "publish_to_email",
            "publish_to_whatsapp",
            "publish_to_sms",
            "meeting_starts_at",
            "meeting_duration_minutes",
            "meeting_location",
            "meeting_agenda",
            "google_meet_url",
            "microsoft_teams_url",
            "zoom_url",
            "attachment_name",
            "attachment_size",
            "has_attachment",
            "company_id",
            "company_name",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "is_active",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def get_created_by_name(self, obj):
        user = obj.created_by
        if getattr(user, "full_name", ""):
            return user.full_name
        return user.email

    def get_target_user_email(self, obj):
        if obj.target_user:
            return obj.target_user.email
        return None

    def get_attachment_name(self, obj):
        if obj.attachment:
            return os.path.basename(obj.attachment.name)
        return None

    def get_attachment_size(self, obj):
        if obj.attachment:
            try:
                return obj.attachment.size
            except Exception:
                return None
        return None

    def get_has_attachment(self, obj):
        return bool(obj.attachment)


class AnnouncementListSerializer(AnnouncementGroupReadMixin, serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    content_preview = serializers.SerializerMethodField()
    target_user_email = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    has_attachment = serializers.SerializerMethodField()
    publish_to_whatsapp = serializers.BooleanField(source="publish_to_sms", read_only=True)
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "content_preview",
            "announcement_type",
            "whole_company",
            "whatsapp_group_id",
            "target_roles",
            "target_user",
            "target_user_email",
            "publish_to_dashboard",
            "publish_to_email",
            "publish_to_whatsapp",
            "publish_to_sms",
            "meeting_starts_at",
            "meeting_duration_minutes",
            "meeting_location",
            "meeting_agenda",
            "google_meet_url",
            "microsoft_teams_url",
            "zoom_url",
            "created_by_name",
            "attachment_name",
            "has_attachment",
            "company_id",
            "company_name",
            "created_at",
            "is_active",
        ]

    def get_content_preview(self, obj):
        """Return first 150 characters of content"""
        if len(obj.content) > 150:
            return obj.content[:150] + "..."
        return obj.content

    def get_created_by_name(self, obj):
        user = obj.created_by
        if getattr(user, "full_name", ""):
            return user.full_name
        return user.email

    def get_target_user_email(self, obj):
        if obj.target_user:
            return obj.target_user.email
        return None

    def get_attachment_name(self, obj):
        if obj.attachment:
            return os.path.basename(obj.attachment.name)
        return None

    def get_has_attachment(self, obj):
        return bool(obj.attachment)


class AnnouncementCreateSerializer(serializers.ModelSerializer):
    target_roles = serializers.JSONField(required=False)
    target_user_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        allow_empty=False,
    )
    publish_to_whatsapp = serializers.BooleanField(source="publish_to_sms", required=False)

    class Meta:
        model = Announcement
        fields = [
            "title",
            "content",
            "announcement_type",
            "whole_company",
            "whatsapp_group_id",
            "target_roles",
            "target_user",
            "target_user_ids",
            "publish_to_dashboard",
            "publish_to_email",
            "publish_to_whatsapp",
            "publish_to_sms",
            "meeting_starts_at",
            "meeting_duration_minutes",
            "meeting_location",
            "meeting_agenda",
            "google_meet_url",
            "microsoft_teams_url",
            "zoom_url",
            "attachment",
        ]

    def to_internal_value(self, data):
        if "publish_to_whatsapp" not in data:
            return super().to_internal_value(data)

        mutable_data = data.copy()
        boolean_field = serializers.BooleanField()
        whatsapp_value = boolean_field.to_internal_value(mutable_data.get("publish_to_whatsapp"))
        if "publish_to_sms" in mutable_data:
            sms_value = boolean_field.to_internal_value(mutable_data.get("publish_to_sms"))
            if sms_value != whatsapp_value:
                raise serializers.ValidationError(
                    {"publish_to_whatsapp": "Must match deprecated publish_to_sms when both are supplied."}
                )

        mutable_data["publish_to_sms"] = mutable_data.get("publish_to_whatsapp")
        del mutable_data["publish_to_whatsapp"]
        return super().to_internal_value(mutable_data)

    def validate_whatsapp_group_id(self, value):
        if not value:
            return ""
        request = self.context.get("request")
        if not request or get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            raise serializers.ValidationError("Only HR administrators can select announcement groups.")
        company = get_active_company_for_request(request)
        if value not in configured_groups(company):
            raise serializers.ValidationError("Select an approved WhatsApp group for the active company.")
        return value

    def validate_target_roles(self, value):
        """Validate that target_roles contains valid role names"""
        valid_roles = ["CEO"]
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError("target_roles must be a valid JSON array") from exc
        if not isinstance(value, list):
            raise serializers.ValidationError("target_roles must be a list")

        for role in value:
            if role not in valid_roles:
                raise serializers.ValidationError(f"Invalid role: {role}. Must be one of {valid_roles}")

        return value

    def validate(self, attrs):
        group_id = attrs.get("whatsapp_group_id", getattr(self.instance, "whatsapp_group_id", ""))
        whatsapp_enabled = attrs.get("publish_to_sms", getattr(self.instance, "publish_to_sms", False))
        if group_id and not whatsapp_enabled:
            if "whatsapp_group_id" in attrs:
                raise serializers.ValidationError(
                    {"whatsapp_group_id": "Enable WhatsApp publishing to select a group."}
                )
            attrs["whatsapp_group_id"] = ""
        whole_company = attrs.get("whole_company", getattr(self.instance, "whole_company", False))
        # An explicit audience replaces the previous private/role audience on edit.
        if "whole_company" in attrs or "target_user_ids" in attrs:
            attrs.setdefault("target_roles", [])
            attrs.setdefault("target_user", None)
        attrs.setdefault("target_roles", getattr(self.instance, "target_roles", []))
        target_roles = attrs.get("target_roles", getattr(self.instance, "target_roles", None))
        target_user = attrs.get("target_user", getattr(self.instance, "target_user", None))
        target_user_ids = attrs.get("target_user_ids") or []
        announcement_type = (
            attrs.get("announcement_type")
            or getattr(self.instance, "announcement_type", None)
            or Announcement.AnnouncementType.GENERAL
        )
        meeting_starts_at = attrs.get("meeting_starts_at", getattr(self.instance, "meeting_starts_at", None))

        allow_empty_targets_for_manager = bool(self.context.get("allow_empty_targets_for_manager"))

        if any(role != "CEO" for role in (target_roles or [])):
            raise serializers.ValidationError(
                {"target_roles": "Only CEO is a supported target role. Choose an audience."}
            )
        if whole_company and (target_roles or target_user or target_user_ids):
            raise serializers.ValidationError("Whole company cannot be combined with private or role targets.")
        if target_user and target_roles:
            raise serializers.ValidationError("Single-user and role targets cannot be combined.")
        if target_user_ids and (target_user or target_roles):
            raise serializers.ValidationError("Selected employees cannot be combined with role or single-user targets")

        if announcement_type == Announcement.AnnouncementType.MEETING:
            if not target_user_ids and not target_user and not whole_company and not target_roles:
                raise serializers.ValidationError(
                    {"target_user_ids": "Select at least one employee for a meeting notification."}
                )
            if not meeting_starts_at:
                raise serializers.ValidationError({"meeting_starts_at": "Meeting date and time is required."})

        if (
            not target_user
            and not target_roles
            and not target_user_ids
            and not whole_company
            and not allow_empty_targets_for_manager
        ):
            raise serializers.ValidationError("At least one target role or a target user is required")

        return attrs

    def validate_target_user(self, value):
        if value is None:
            return value
        request = self.context.get("request")
        if not request:
            raise serializers.ValidationError("Request context is required.")
        scoped_profiles = filter_queryset_by_company_scope(
            EmployeeProfile.objects.filter(
                user=value,
                user__is_active=True,
                is_archived=False,
                employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            ),
            request,
        )
        if not scoped_profiles.exists():
            raise serializers.ValidationError("Target user must be active and belong to the active company.")
        return value

    def validate_target_user_ids(self, value):
        request = self.context.get("request")
        if not request:
            raise serializers.ValidationError("Request context is required.")

        unique_ids = list(dict.fromkeys(value))
        qs = EmployeeProfile.objects.select_related("user").filter(
            user_id__in=unique_ids,
            user__is_active=True,
            is_archived=False,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        qs = filter_queryset_by_company_scope(qs, request)
        found_user_ids = set(qs.values_list("user_id", flat=True))
        missing_ids = [user_id for user_id in unique_ids if user_id not in found_user_ids]
        if missing_ids:
            raise serializers.ValidationError("Selected employees must be active and belong to the active company.")
        return unique_ids

    def validate_attachment(self, value):
        if not value:
            return value

        content_type = getattr(value, "content_type", "")
        if content_type and content_type != "application/pdf":
            raise serializers.ValidationError("Only PDF files are allowed.")

        max_size = getattr(settings, "MAX_ANNOUNCEMENT_ATTACHMENT_SIZE_BYTES", 5 * 1024 * 1024)
        if value.size > max_size:
            max_size_mb = max_size / (1024 * 1024)
            raise serializers.ValidationError(f"PDF must be {max_size_mb:.0f} MB or smaller.")

        position = value.tell()
        signature = value.read(5)
        value.seek(position)
        if signature != b"%PDF-":
            raise serializers.ValidationError("Attachment content is not a valid PDF file.")

        return value
