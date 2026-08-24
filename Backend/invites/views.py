# invites/views.py

import logging
import secrets
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView

from admin_portal.models import SystemSettings  # ✅ uses /settings default_invite_expiry_hours
from audit.utils import audit
from core.permissions import IsHRManagerOrAdmin
from core.responses import error, success
from core.services import WhatsAppService, send_user_invite_email, send_user_invite_whatsapp
from employees.models import EmployeeProfile

from .models import Invite
from .serializers import (
    InviteAcceptSerializer,
    InviteCreateSerializer,
    InviteSerializer,
    WhatsAppProviderTestSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)


def _normalize_email_delivery_result(result: dict[str, Any] | None) -> dict[str, Any]:
    if not result:
        return {
            "sent": False,
            "provider_submitted": False,
            "provider": "bird",
            "provider_status": "",
            "delivery_status": Invite.DeliveryStatus.FAILED,
            "status_code": None,
            "message_id": None,
            "external_message_id": None,
            "error": "Unknown email delivery error.",
        }
    sent = bool(result.get("success") or result.get("sent"))
    message_id = result.get("message_id")
    return {
        "sent": sent,
        "provider_submitted": sent,
        "provider": "bird",
        "provider_status": _extract_provider_status(result),
        "delivery_status": Invite.DeliveryStatus.SENT if sent else Invite.DeliveryStatus.FAILED,
        "status_code": result.get("status_code"),
        "message_id": message_id,
        "external_message_id": result.get("external_message_id") or message_id,
        "error": result.get("error") or result.get("reason"),
    }


def _normalize_whatsapp_delivery_result(result: dict[str, Any] | None) -> dict[str, Any]:
    if not result:
        return {
            "sent": False,
            "provider_submitted": False,
            "provider": "evolution_whatsapp",
            "provider_status": "",
            "delivery_status": Invite.DeliveryStatus.UNKNOWN,
            "status_code": None,
            "message_id": None,
            "external_message_id": None,
            "error": "Unknown WhatsApp delivery error.",
        }
    provider_submitted = bool(result.get("success") or result.get("sent"))
    provider_status = _extract_provider_status(result)
    delivery_status = _whatsapp_delivery_status(provider_submitted=provider_submitted, provider_status=provider_status)
    message_id = result.get("message_id")
    return {
        "sent": delivery_status
        in {
            Invite.DeliveryStatus.SENT,
            Invite.DeliveryStatus.DELIVERED,
            Invite.DeliveryStatus.READ,
        },
        "provider_submitted": provider_submitted,
        "provider": result.get("provider", "evolution_whatsapp"),
        "provider_status": provider_status,
        "delivery_status": delivery_status,
        "status_code": result.get("status_code"),
        "message_id": message_id,
        "external_message_id": result.get("external_message_id") or message_id,
        "error": result.get("error") or result.get("reason"),
    }


def _extract_provider_status(result: dict[str, Any] | None) -> str:
    if not result:
        return ""

    direct_keys = ("provider_status", "message_status", "messageStatus", "delivery_status", "deliveryStatus", "status")
    for key in direct_keys:
        value = result.get(key)
        if value not in (None, ""):
            return str(value).strip()

    for key in ("message", "data", "response"):
        nested = result.get(key)
        if isinstance(nested, dict):
            nested_status = _extract_provider_status(nested)
            if nested_status:
                return nested_status

    return ""


def _whatsapp_delivery_status(*, provider_submitted: bool, provider_status: str) -> str:
    if not provider_submitted:
        return Invite.DeliveryStatus.FAILED

    normalized = provider_status.strip().lower().replace("-", "_").replace(" ", "_")
    failed_statuses = {"0", "error", "failed"}
    if normalized in failed_statuses:
        return Invite.DeliveryStatus.FAILED
    return Invite.DeliveryStatus.QUEUED


def _inviter_name(user) -> str:
    return getattr(user, "full_name", "") or getattr(user, "email", "") or ""


def _send_invite_delivery(
    *,
    invite: Invite,
    invite_link: str,
    expires_in_hours: int,
    inviter_name: str,
    is_reminder: bool = False,
) -> dict[str, Any]:
    if invite.channel == Invite.Channel.WHATSAPP:
        try:
            return send_user_invite_whatsapp(
                phone_number=invite.phone_number or "",
                role=invite.role,
                invite_link=invite_link,
                expires_in_hours=expires_in_hours,
                inviter_name=inviter_name,
            )
        except Exception as exc:  # pragma: no cover - defensive guard around external delivery
            logger.exception(
                "invite_whatsapp_send_unhandled_exception",
                extra={"invite_id": invite.id, "channel": invite.channel},
            )
            return {"success": False, "provider": "evolution_whatsapp", "error": str(exc)}

    try:
        return send_user_invite_email(
            to_email=invite.email or "",
            role=invite.role,
            invite_link=invite_link,
            expires_in_hours=expires_in_hours,
            inviter_name=inviter_name,
            is_reminder=is_reminder,
        )
    except Exception as exc:  # pragma: no cover - defensive guard around external delivery
        logger.exception(
            "invite_email_send_unhandled_exception",
            extra={"invite_id": invite.id, "channel": invite.channel},
        )
        return {"success": False, "provider": "bird", "error": str(exc)}


def _normalize_delivery_result(channel: str, result: dict[str, Any] | None) -> dict[str, Any]:
    if channel == Invite.Channel.WHATSAPP:
        return _normalize_whatsapp_delivery_result(result)
    return _normalize_email_delivery_result(result)


def _truncate_delivery_text(value: Any, max_length: int) -> str:
    return str(value or "").strip()[:max_length]


def _coerce_status_code(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_whatsapp_test_result(result: dict[str, Any] | None) -> dict[str, Any]:
    delivery = _normalize_whatsapp_delivery_result(result)
    return {
        "sent": bool(delivery.get("provider_submitted")),
        "provider_submitted": delivery.get("provider_submitted"),
        "provider": delivery.get("provider") or "evolution_whatsapp",
        "provider_status": delivery.get("provider_status") or None,
        "delivery_status": delivery.get("delivery_status"),
        "status_code": delivery.get("status_code") or None,
        "message_id": delivery.get("message_id"),
        "external_message_id": delivery.get("external_message_id"),
        "error": delivery.get("error"),
    }


def _record_invite_delivery(*, invite: Invite, channel: str, result: dict[str, Any] | None) -> dict[str, Any]:
    delivery = _normalize_delivery_result(channel, result)
    invite.last_delivery_channel = channel
    invite.last_delivery_sent = bool(delivery["sent"])
    invite.last_delivery_provider = _truncate_delivery_text(delivery.get("provider"), 64)
    invite.last_delivery_status_code = _coerce_status_code(delivery.get("status_code"))
    invite.last_delivery_message_id = _truncate_delivery_text(delivery.get("message_id"), 255)
    invite.last_delivery_error = _truncate_delivery_text(delivery.get("error"), 500)
    invite.last_delivery_at = timezone.now()
    invite.provider_submitted = delivery.get("provider_submitted")
    invite.provider_status = _truncate_delivery_text(delivery.get("provider_status"), 64)
    invite.delivery_status = delivery.get("delivery_status") or Invite.DeliveryStatus.UNKNOWN
    invite.external_message_id = _truncate_delivery_text(delivery.get("external_message_id"), 255)
    invite.save(
        update_fields=[
            "last_delivery_channel",
            "last_delivery_sent",
            "last_delivery_provider",
            "last_delivery_status_code",
            "last_delivery_message_id",
            "last_delivery_error",
            "last_delivery_at",
            "provider_submitted",
            "provider_status",
            "delivery_status",
            "external_message_id",
        ]
    )
    return delivery


def _generate_invite_employee_id() -> str:
    for _ in range(20):
        candidate = f"FFI-{secrets.token_hex(3).upper()}"
        if not EmployeeProfile.objects.filter(employee_id=candidate).exists():
            return candidate
    raise IntegrityError("Failed to generate unique employee_id for invite acceptance.")


def _ensure_invited_employee_profile(
    *, user, full_name: str, phone_number: str, employee_profile: EmployeeProfile | None = None
) -> EmployeeProfile:
    if employee_profile is not None:
        if employee_profile.user_id and employee_profile.user_id != user.id:
            raise IntegrityError("The invited employee profile already has a user account.")
        employee_profile.user = user
        employee_profile.full_name = full_name or employee_profile.full_name or getattr(user, "full_name", "") or ""
        if phone_number:
            employee_profile.mobile = phone_number
        update_fields = ["user", "full_name", "mobile", "updated_at"]
        if employee_profile.employment_status == EmployeeProfile.EmploymentStatus.PREHIRE:
            employee_profile.employment_status = EmployeeProfile.EmploymentStatus.ACTIVE
            update_fields.append("employment_status")
        employee_profile.save(update_fields=update_fields)
        return employee_profile

    profile, created = EmployeeProfile.objects.get_or_create(
        user=user,
        defaults={
            "employee_id": _generate_invite_employee_id(),
            "full_name": full_name or getattr(user, "full_name", "") or "",
            "mobile": phone_number or "",
        },
    )
    update_fields = []
    if not created:
        if full_name and not profile.full_name:
            profile.full_name = full_name
            update_fields.append("full_name")
        if phone_number:
            profile.mobile = phone_number
            update_fields.append("mobile")
        if update_fields:
            profile.save(update_fields=update_fields)
    return profile


class InvitesPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    page_query_param = "page"
    max_page_size = 200

    def get_paginated_response(self, data):
        """
        Matches your global envelope and provides page meta.
        """
        return success(
            {
                "items": data,
                "page": self.page.number,
                "page_size": self.get_page_size(self.request),
                "count": self.page.paginator.count,
                "total_pages": self.page.paginator.num_pages,
            }
        )


def normalize_expired_invites():
    """
    Converts SENT invites to EXPIRED when expires_at passed.
    Cheap + safe to run on list endpoint.
    """
    Invite.objects.filter(status=Invite.Status.SENT, expires_at__lte=timezone.now()).update(
        status=Invite.Status.EXPIRED
    )


class InvitesListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        normalize_expired_invites()

        qs = Invite.objects.all()

        # Optional filters
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)

        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(email__icontains=search) | Q(role__icontains=search))

        paginator = InvitesPagination()
        page = paginator.paginate_queryset(qs, request)
        data = InviteSerializer(page, many=True).data
        return paginator.get_paginated_response(data)

    @transaction.atomic
    def post(self, request):
        s = InviteCreateSerializer(data=request.data, context={"request": request})
        if not s.is_valid():
            return error("Validation error", errors=s.errors, status=422)

        email = s.validated_data.get("email")
        phone_number = s.validated_data.get("phone_number")
        channel = s.validated_data["channel"]
        role = s.validated_data["role"]
        expires_in_hours = s.validated_data.get("expires_in_hours")
        if not expires_in_hours:
            settings_obj = SystemSettings.get_solo()
            expires_in_hours = settings_obj.default_invite_expiry_hours

        # Prevent inviting an already registered user (Phase 1-friendly)
        if email and User.objects.filter(email__iexact=email).exists():
            return error("Validation error", errors={"email": ["Email is already registered."]}, status=422)

        now = timezone.now()
        expires_at = now + timedelta(hours=expires_in_hours)

        invite = Invite.objects.create(
            email=email,
            phone_number=phone_number,
            channel=channel,
            role=role,
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=expires_at,
            created_by=request.user,
        )

        audit(
            request,
            action="invite_sent",
            entity="invite",
            entity_id=invite.id,
            metadata={
                "email": email,
                "phone_number": phone_number,
                "channel": channel,
                "role": role,
                "expires_at": invite.expires_at.isoformat(),
            },
        )

        link = f"{settings.FRONTEND_URL}/register?token={invite.token}"
        delivery_result = _send_invite_delivery(
            invite=invite,
            invite_link=link,
            expires_in_hours=expires_in_hours,
            inviter_name=_inviter_name(request.user),
        )
        delivery = _record_invite_delivery(invite=invite, channel=invite.channel, result=delivery_result)
        if not delivery.get("provider_submitted"):
            logger.warning(
                "invite_delivery_failed",
                extra={
                    "invite_id": invite.id,
                    "channel": invite.channel,
                    "error": delivery.get("error"),
                },
            )

        return success(InviteSerializer(invite).data, status=status.HTTP_201_CREATED)


class InviteWhatsAppProviderTestView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request):
        serializer = WhatsAppProviderTestSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)

        phone_number = serializer.validated_data["phone_number"]
        try:
            result = WhatsAppService().send_template_message(
                phone_number=phone_number,
                template_name="whatsapp_provider_test",
                template_variables={"provider_name": "Evolution"},
            )
        except Exception as exc:  # pragma: no cover - defensive guard around external provider checks
            logger.exception("whatsapp_provider_test_unhandled_exception")
            result = {"success": False, "provider": "evolution_whatsapp", "error": str(exc)}

        return success(_normalize_whatsapp_test_result(result))


class InviteResendView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    @transaction.atomic
    def post(self, request, invite_id: int):
        try:
            invite = Invite.objects.select_for_update().get(id=invite_id)
        except Invite.DoesNotExist:
            return error("Invite not found", status=404)

        # Cannot resend if accepted or revoked
        if invite.status in (Invite.Status.ACCEPTED, Invite.Status.REVOKED):
            return error(f"Cannot resend invite in status '{invite.status}'.", status=409)

        now = timezone.now()

        # If expired, re-open it using settings.default_invite_expiry_hours
        if invite.status == Invite.Status.EXPIRED or invite.expires_at <= now:
            invite.status = Invite.Status.SENT
            settings_obj = SystemSettings.get_solo()
            invite.expires_at = now + timedelta(hours=settings_obj.default_invite_expiry_hours)

        invite.token = Invite.generate_token()
        invite.resend_count += 1
        invite.last_resent_at = now
        invite.sent_at = now

        invite.save(
            update_fields=[
                "status",
                "expires_at",
                "token",
                "resend_count",
                "last_resent_at",
                "sent_at",
            ]
        )

        audit(
            request,
            action="invite_resent",
            entity="invite",
            entity_id=invite.id,
            metadata={
                "email": invite.email,
                "phone_number": invite.phone_number,
                "channel": invite.channel,
                "role": invite.role,
                "expires_at": invite.expires_at.isoformat(),
            },
        )

        link = f"{settings.FRONTEND_URL}/register?token={invite.token}"
        remaining_hours = max(1, int((invite.expires_at - now).total_seconds() // 3600))
        delivery_result = _send_invite_delivery(
            invite=invite,
            invite_link=link,
            expires_in_hours=remaining_hours,
            inviter_name=_inviter_name(request.user),
            is_reminder=True,
        )
        delivery = _record_invite_delivery(invite=invite, channel=invite.channel, result=delivery_result)
        if not delivery.get("provider_submitted"):
            logger.warning(
                "invite_resend_delivery_failed",
                extra={
                    "invite_id": invite.id,
                    "channel": invite.channel,
                    "error": delivery.get("error"),
                },
            )

        return success(InviteSerializer(invite).data)


class InviteRevokeView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, invite_id: int):
        normalize_expired_invites()

        try:
            invite = Invite.objects.get(id=invite_id)
        except Invite.DoesNotExist:
            return error("Invite not found", status=404)

        return success(InviteSerializer(invite).data)

    @transaction.atomic
    def delete(self, request, invite_id: int):
        try:
            invite = Invite.objects.select_for_update().get(id=invite_id)
        except Invite.DoesNotExist:
            return error("Invite not found", status=404)

        if invite.status == Invite.Status.ACCEPTED:
            return error("Cannot revoke an accepted invite.", status=409)

        invite.status = Invite.Status.REVOKED
        invite.revoked_by = request.user
        invite.revoked_at = timezone.now()
        invite.save(update_fields=["status", "revoked_by", "revoked_at"])

        audit(
            request,
            action="invite_revoked",
            entity="invite",
            entity_id=invite.id,
            metadata={"email": invite.email, "role": invite.role},
        )

        return success({})


class InviteAcceptView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        token = (request.query_params.get("token") or "").strip()
        if not token:
            return error("Validation error", errors={"token": ["token is required."]}, status=422)

        try:
            invite = Invite.objects.get(token=token)
        except Invite.DoesNotExist:
            return error("Validation error", errors={"token": ["Invalid invitation token."]}, status=422)

        invite.refresh_expired_status_if_needed()
        if invite.status == Invite.Status.ACCEPTED:
            return error("Validation error", errors={"token": ["Invitation already accepted."]}, status=422)
        if invite.status == Invite.Status.REVOKED:
            return error("Validation error", errors={"token": ["Invitation has been revoked."]}, status=422)
        if invite.status == Invite.Status.EXPIRED or invite.expires_at <= timezone.now():
            return error("Validation error", errors={"token": ["Invitation has expired."]}, status=422)

        return success(
            {
                "email": invite.email,
                "channel": invite.channel,
                "phone_number": invite.phone_number,
                "role": invite.role,
                "expires_at": invite.expires_at.isoformat(),
            }
        )

    @transaction.atomic
    def post(self, request):
        s = InviteAcceptSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors, status=422)

        invite: Invite = s.validated_data["invite"]
        email: str = s.validated_data["email"]
        phone_number: str = s.validated_data.get("phone_number", "")
        submitted_phone_number: str = s.validated_data.get("submitted_phone_number", "")
        password: str = s.validated_data["password"]
        full_name: str = (s.validated_data.get("full_name") or "").strip()

        if User.objects.filter(email__iexact=email).exists():
            return error("Validation error", errors={"email": ["Email is already registered."]}, status=422)

        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    email=email,
                    password=password,
                    full_name=full_name,
                    is_active=True,
                )
        except IntegrityError:
            return error("Validation error", errors={"email": ["Email is already registered."]}, status=422)
        group, _ = Group.objects.get_or_create(name=invite.role)
        user.groups.clear()
        user.groups.add(group)
        profile = _ensure_invited_employee_profile(
            user=user,
            full_name=full_name,
            phone_number=phone_number,
            employee_profile=invite.employee_profile,
        )

        invite.status = Invite.Status.ACCEPTED
        update_fields = ["status"]
        if not invite.email:
            invite.email = email
            update_fields.append("email")
        if submitted_phone_number:
            invite.phone_number = submitted_phone_number
            update_fields.append("phone_number")
        invite.save(update_fields=update_fields)

        audit(
            request,
            action="invite_accepted",
            entity="invite",
            entity_id=invite.id,
            metadata={
                "email": invite.email,
                "phone_number": phone_number or None,
                "role": invite.role,
                "user_id": user.id,
                "employee_profile_id": profile.id,
            },
        )

        from in_app_notifications.dispatcher import dispatch_notification_channels
        from in_app_notifications.models import Notification

        dispatch_notification_channels(
            recipient=user,
            event_key="invite.accepted",
            title="Welcome to the FFI HR System",
            message=f"Your {invite.role} account is ready.",
            category=Notification.Category.INVITE,
            action_url="/login",
            related_object=invite,
            deduplication_key=f"invite.accepted:{invite.id}",
        )

        return success({"email": user.email, "role": invite.role}, status=201)
