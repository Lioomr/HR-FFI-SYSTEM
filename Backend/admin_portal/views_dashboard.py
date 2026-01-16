from datetime import timedelta
from django.utils import timezone
from django.contrib.auth import get_user_model

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsSystemAdmin
from core.responses import success

from invites.models import Invite
from audit.models import AuditLog

User = get_user_model()


class AdminSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def get(self, request):
        now = timezone.now()
        start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_7d = now - timedelta(days=7)

        # ---- Users ----
        users_total = User.objects.count()
        users_active = User.objects.filter(is_active=True).count()
        users_inactive = User.objects.filter(is_active=False).count()

        # ---- Invites ----
        # Normalize expired invites (SENT -> EXPIRED when time passed)
        Invite.objects.filter(
            status=Invite.Status.SENT,
            expires_at__lte=now
        ).update(status=Invite.Status.EXPIRED)

        invites_total = Invite.objects.count()
        invites_sent = Invite.objects.filter(status=Invite.Status.SENT).count()
        invites_expired = Invite.objects.filter(status=Invite.Status.EXPIRED).count()
        invites_revoked = Invite.objects.filter(status=Invite.Status.REVOKED).count()
        invites_accepted = Invite.objects.filter(status=Invite.Status.ACCEPTED).count()

        # ---- Audit activity ----
        audit_today = AuditLog.objects.filter(created_at__gte=start_today).count()
        audit_last_7_days = AuditLog.objects.filter(created_at__gte=start_7d).count()

        # Optional: small breakdown for "activity cards"
        actions_today = (
            AuditLog.objects.filter(created_at__gte=start_today)
            .values("action")
            .order_by("action")
        )

        # If you want top actions with counts:
        from django.db.models import Count
        top_actions_today = (
            AuditLog.objects.filter(created_at__gte=start_today)
            .values("action")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        data = {
            "users": {
                "total": users_total,
                "active": users_active,
                "inactive": users_inactive,
            },
            "invites": {
                "total": invites_total,
                "sent": invites_sent,
                "expired": invites_expired,
                "revoked": invites_revoked,
                "accepted": invites_accepted,
            },
            "audit": {
                "today": audit_today,
                "last_7_days": audit_last_7_days,
                "top_actions_today": list(top_actions_today),
            },
            "server_time": now.isoformat(),
        }

        return success(data)
