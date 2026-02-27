from django.utils import timezone
from rest_framework import serializers

from assets.models import Asset

from .models import Rent, RentType
from .services import compute_rent_state, get_last_reminder_sent_at


class RentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RentType
        fields = ["id", "code", "name_en", "name_ar", "description"]


class RentTypeWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = RentType
        fields = ["id", "code", "name_en", "name_ar", "description"]


class AssetSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = ["id", "name_en", "name_ar"]


class RentReadSerializer(serializers.ModelSerializer):
    rent_type = RentTypeSerializer(read_only=True)
    asset = AssetSummarySerializer(read_only=True)
    next_due_date = serializers.SerializerMethodField()
    days_remaining = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    last_reminder_sent_at = serializers.SerializerMethodField()

    class Meta:
        model = Rent
        fields = [
            "id",
            "rent_type",
            "asset",
            "property_name_en",
            "property_name_ar",
            "property_address",
            "recurrence",
            "one_time_due_date",
            "start_date",
            "due_day",
            "next_due_date",
            "days_remaining",
            "amount",
            "reminder_days",
            "status",
            "last_reminder_sent_at",
        ]

    def _computed(self, obj: Rent):
        return compute_rent_state(obj, today=timezone.localdate())

    def get_next_due_date(self, obj):
        computed = self._computed(obj)
        return computed.next_due_date.isoformat() if computed.next_due_date else None

    def get_days_remaining(self, obj):
        return self._computed(obj).days_remaining

    def get_status(self, obj):
        return self._computed(obj).status

    def get_last_reminder_sent_at(self, obj):
        last_sent = get_last_reminder_sent_at(obj)
        return last_sent.isoformat() if last_sent else None


class RentWriteSerializer(serializers.ModelSerializer):
    rent_type_id = serializers.PrimaryKeyRelatedField(queryset=RentType.objects.filter(is_active=True), source="rent_type")
    asset_id = serializers.PrimaryKeyRelatedField(queryset=Asset.objects.all(), source="asset", required=False, allow_null=True)

    class Meta:
        model = Rent
        fields = [
            "id",
            "rent_type_id",
            "asset_id",
            "property_name_en",
            "property_name_ar",
            "property_address",
            "recurrence",
            "one_time_due_date",
            "start_date",
            "due_day",
            "reminder_days",
            "amount",
        ]

    def validate(self, attrs):
        instance = self.instance
        data = {
            "rent_type": attrs.get("rent_type", getattr(instance, "rent_type", None)),
            "asset": attrs.get("asset", getattr(instance, "asset", None)),
            "property_name_en": attrs.get("property_name_en", getattr(instance, "property_name_en", "")),
            "property_name_ar": attrs.get("property_name_ar", getattr(instance, "property_name_ar", "")),
            "property_address": attrs.get("property_address", getattr(instance, "property_address", "")),
            "recurrence": attrs.get("recurrence", getattr(instance, "recurrence", None)),
            "one_time_due_date": attrs.get("one_time_due_date", getattr(instance, "one_time_due_date", None)),
            "start_date": attrs.get("start_date", getattr(instance, "start_date", None)),
            "due_day": attrs.get("due_day", getattr(instance, "due_day", None)),
            "reminder_days": attrs.get("reminder_days", getattr(instance, "reminder_days", 30)),
            "amount": attrs.get("amount", getattr(instance, "amount", None)),
        }

        temp = Rent(**data)
        temp.clean()
        return attrs
