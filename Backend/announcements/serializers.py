from rest_framework import serializers

from .models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    target_user_email = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "content",
            "target_roles",
            "target_user",
            "target_user_email",
            "publish_to_dashboard",
            "publish_to_email",
            "publish_to_sms",
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


class AnnouncementListSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    content_preview = serializers.SerializerMethodField()
    target_user_email = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "content_preview",
            "target_roles",
            "target_user",
            "target_user_email",
            "created_by_name",
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


class AnnouncementCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = [
            "title",
            "content",
            "target_roles",
            "target_user",
            "publish_to_dashboard",
            "publish_to_email",
            "publish_to_sms",
        ]

    def validate_target_roles(self, value):
        """Validate that target_roles contains valid role names"""
        valid_roles = ["ADMIN", "HR_MANAGER", "MANAGER", "EMPLOYEE"]
        if not isinstance(value, list):
            raise serializers.ValidationError("target_roles must be a list")

        for role in value:
            if role not in valid_roles:
                raise serializers.ValidationError(f"Invalid role: {role}. Must be one of {valid_roles}")

        return value

    def validate(self, attrs):
        target_roles = attrs.get("target_roles")
        target_user = attrs.get("target_user")

        allow_empty_targets_for_manager = bool(self.context.get("allow_empty_targets_for_manager"))

        if not target_user and not target_roles and not allow_empty_targets_for_manager:
            raise serializers.ValidationError("At least one target role or a target user is required")

        return attrs
