from django.utils import timezone
from rest_framework import serializers

from assets.models import Asset

from .models import Rent, RentPayment, RentType
from .services import compute_rent_state, get_last_reminder_sent_at


class RentTypeSerializer(serializers.ModelSerializer):
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = RentType
        fields = ["id", "code", "name_en", "name_ar", "description", "company_id", "company_name"]


class RentTypeWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = RentType
        fields = ["id", "code", "name_en", "name_ar", "description"]


class AssetSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = ["id", "name_en", "name_ar"]


class RentPaymentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = RentPayment
        fields = [
            "id",
            "payment_number",
            "category",
            "status",
            "amount",
            "due_date",
            "paid_date",
            "notes",
            "created_by_name",
            "created_at",
            "updated_at",
        ]


class RentPaymentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = RentPayment
        fields = ["id", "payment_number", "category", "status", "amount", "due_date", "paid_date", "notes"]

    def validate_payment_number(self, value):
        if value < 1:
            raise serializers.ValidationError("Payment number must be greater than zero.")
        return value

    def validate_amount(self, value):
        if value < 0:
            raise serializers.ValidationError("Amount cannot be negative.")
        return value

    def validate(self, attrs):
        rent = self.context.get("rent")
        instance = self.instance
        payment_number = attrs.get("payment_number", getattr(instance, "payment_number", None))
        status = attrs.get("status", getattr(instance, "status", RentPayment.Status.PENDING))
        paid_date = attrs.get("paid_date", getattr(instance, "paid_date", None))

        if status == RentPayment.Status.PAID and not paid_date:
            raise serializers.ValidationError({"paid_date": ["Paid date is required when status is paid."]})
        if status != RentPayment.Status.PAID and paid_date:
            raise serializers.ValidationError({"paid_date": ["Paid date must be empty unless status is paid."]})

        if rent is not None and payment_number is not None:
            duplicates = RentPayment.objects.filter(rent=rent, payment_number=payment_number, is_active=True)
            if instance is not None:
                duplicates = duplicates.exclude(pk=instance.pk)
            if duplicates.exists():
                raise serializers.ValidationError(
                    {"payment_number": ["A payment record with this number already exists for this rent."]}
                )

        return attrs


class RentReadSerializer(serializers.ModelSerializer):
    rent_type = RentTypeSerializer(read_only=True)
    asset = AssetSummarySerializer(read_only=True)
    next_due_date = serializers.SerializerMethodField()
    days_remaining = serializers.SerializerMethodField()
    remaining_lease_duration = serializers.SerializerMethodField()
    notification_date = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    last_reminder_sent_at = serializers.SerializerMethodField()
    payment_records = RentPaymentSerializer(many=True, read_only=True)
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = Rent
        fields = [
            "id",
            "rent_type",
            "asset",
            "property_name_en",
            "property_name_ar",
            "property_address",
            "lease_start_date",
            "lease_end_date",
            "remaining_lease_duration",
            "annual_rent_value",
            "security_deposit",
            "payment_schedule",
            "auto_renewal",
            "notification_date",
            "notice",
            "payments",
            "payment_records",
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
            "company_id",
            "company_name",
        ]

    def _computed(self, obj: Rent):
        return compute_rent_state(obj, today=timezone.localdate())

    def get_next_due_date(self, obj):
        computed = self._computed(obj)
        return computed.next_due_date.isoformat() if computed.next_due_date else None

    def get_days_remaining(self, obj):
        return self._computed(obj).days_remaining

    def get_remaining_lease_duration(self, obj):
        return self._computed(obj).remaining_lease_duration

    def get_notification_date(self, obj):
        computed = self._computed(obj)
        return computed.notification_date.isoformat() if computed.notification_date else None

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
            "lease_start_date",
            "lease_end_date",
            "annual_rent_value",
            "security_deposit",
            "payment_schedule",
            "auto_renewal",
            "notice",
            "payments",
            "recurrence",
            "one_time_due_date",
            "start_date",
            "due_day",
            "reminder_days",
            "amount",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        company = getattr(request, "_active_company", None) if request else None
        if self.instance and getattr(self.instance, "company_id", None):
            company = self.instance.company
        if company is not None:
            self.fields["rent_type_id"].queryset = RentType.objects.filter(company=company, is_active=True)
            self.fields["asset_id"].queryset = Asset.objects.filter(company=company)

    def validate(self, attrs):
        instance = self.instance
        data = {
            "rent_type": attrs.get("rent_type", getattr(instance, "rent_type", None)),
            "asset": attrs.get("asset", getattr(instance, "asset", None)),
            "property_name_en": attrs.get("property_name_en", getattr(instance, "property_name_en", "")),
            "property_name_ar": attrs.get("property_name_ar", getattr(instance, "property_name_ar", "")),
            "property_address": attrs.get("property_address", getattr(instance, "property_address", "")),
            "lease_start_date": attrs.get("lease_start_date", getattr(instance, "lease_start_date", None)),
            "lease_end_date": attrs.get("lease_end_date", getattr(instance, "lease_end_date", None)),
            "annual_rent_value": attrs.get("annual_rent_value", getattr(instance, "annual_rent_value", None)),
            "security_deposit": attrs.get("security_deposit", getattr(instance, "security_deposit", None)),
            "payment_schedule": attrs.get("payment_schedule", getattr(instance, "payment_schedule", "")),
            "auto_renewal": attrs.get("auto_renewal", getattr(instance, "auto_renewal", False)),
            "notice": attrs.get("notice", getattr(instance, "notice", "")),
            "payments": attrs.get("payments", getattr(instance, "payments", "")),
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
