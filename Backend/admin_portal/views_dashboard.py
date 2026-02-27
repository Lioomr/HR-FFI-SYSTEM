from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from audit.models import AuditLog
from audit.serializers import AuditLogSerializer
from core.permissions import IsSystemAdmin
from core.responses import success
from invites.models import Invite

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

        # Calculate trends (vs 7 days ago)
        users_total_7d_ago = User.objects.filter(date_joined__lt=start_7d).count()
        if users_total_7d_ago > 0:
            users_growth_pct = round(((users_total - users_total_7d_ago) / users_total_7d_ago) * 100, 1)
        else:
            users_growth_pct = 0 if users_total == 0 else 100

        # Note: We don't have historical "active" status in a simple way without audit logs.
        # Let's placeholder it as 0 for now.
        users_active_growth_pct = 0

        # ---- Invites ----
        # Normalize expired invites (SENT -> EXPIRED when time passed)
        Invite.objects.filter(status=Invite.Status.SENT, expires_at__lte=now).update(status=Invite.Status.EXPIRED)

        invites_total = Invite.objects.count()
        invites_sent = Invite.objects.filter(status=Invite.Status.SENT).count()
        invites_expired = Invite.objects.filter(status=Invite.Status.EXPIRED).count()
        invites_revoked = Invite.objects.filter(status=Invite.Status.REVOKED).count()
        invites_accepted = Invite.objects.filter(status=Invite.Status.ACCEPTED).count()

        # ---- Audit activity ----
        audit_today = AuditLog.objects.filter(created_at__gte=start_today).count()
        audit_last_7_days = AuditLog.objects.filter(created_at__gte=start_7d).count()
        recent_audits = AuditLog.objects.select_related("actor").order_by("-created_at")[:10]

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
                "total_growth_pct": users_growth_pct,
                "active_growth_pct": users_active_growth_pct,
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
                "recent": AuditLogSerializer(recent_audits, many=True).data,
                "top_actions_today": list(top_actions_today),
            },
            "server_time": now.isoformat(),
        }

        return success(data)
