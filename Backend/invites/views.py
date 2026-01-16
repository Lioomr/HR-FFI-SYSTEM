# invites/views.py

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.db.models import Q

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework import status

from core.responses import success, error
from core.permissions import IsSystemAdmin
from audit.utils import audit

from admin_portal.models import SystemSettings  # ✅ uses /settings default_invite_expiry_hours

from .models import Invite
from .serializers import InviteCreateSerializer, InviteSerializer

User = get_user_model()


class InvitesPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    page_query_param = "page"
    max_page_size = 200

    def get_paginated_response(self, data):
        """
        Matches your global envelope and provides page meta.
        """
        return success({
            "items": data,
            "page": self.page.number,
            "page_size": self.get_page_size(self.request),
            "count": self.page.paginator.count,
            "total_pages": self.page.paginator.num_pages,
        })


def normalize_expired_invites():
    """
    Converts SENT invites to EXPIRED when expires_at passed.
    Cheap + safe to run on list endpoint.
    """
    Invite.objects.filter(
        status=Invite.Status.SENT,
        expires_at__lte=timezone.now()
    ).update(status=Invite.Status.EXPIRED)


class InvitesListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

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
        s = InviteCreateSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors, status=422)

        email = s.validated_data["email"]
        role = s.validated_data["role"]
        expires_in_hours = s.validated_data["expires_in_hours"]

        # Prevent inviting an already registered user (Phase 1-friendly)
        if User.objects.filter(email__iexact=email).exists():
            return error("Validation error", errors={"email": ["Email is already registered."]}, status=422)

        now = timezone.now()
        expires_at = now + timedelta(hours=expires_in_hours)

        invite = Invite.objects.create(
            email=email,
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
                "role": role,
                "expires_at": invite.expires_at.isoformat(),
            },
        )

        return success(InviteSerializer(invite).data, status=status.HTTP_201_CREATED)


class InviteResendView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

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

        invite.save(update_fields=[
            "status",
            "expires_at",
            "token",
            "resend_count",
            "last_resent_at",
            "sent_at",
        ])

        audit(
            request,
            action="invite_resent",
            entity="invite",
            entity_id=invite.id,
            metadata={
                "email": invite.email,
                "role": invite.role,
                "expires_at": invite.expires_at.isoformat(),
            },
        )

        return success(InviteSerializer(invite).data)


class InviteRevokeView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

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
