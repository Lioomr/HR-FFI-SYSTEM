from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from attendance.models import AttendanceRecord
from audit.utils import audit
from core.permissions import IsHRManagerOrAdmin
from core.responses import success
from core.serializers import DelegationRuleSerializer, UserPreferenceSerializer
from core.services import (
    build_pending_approval_item,
    get_pending_approvals_for_user,
    send_delegation_notification_email,
    sync_workflow,
)
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest
from loans.models import LoanRequest
from payroll.models import PayrollRun
from audit.models import AuditLog
from audit.views import apply_filters, AuditPagination
from .models import DelegationRule, UserPreference
from .permissions import get_role


def _safe_send_delegation_emails(rule: DelegationRule):
    creator_role = get_role(rule.created_by) if rule.created_by else ""
    if creator_role == "SystemAdmin":
        role_route = "/admin/workflow/delegations"
    elif creator_role == "HRManager":
        role_route = "/hr/workflow/delegations"
    else:
        role_route = "/login"
    action_url = None
    frontend_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    if frontend_url and role_route:
        action_url = f"{frontend_url}{role_route}"

    users = [
        (rule.from_user, "delegator"),
        (rule.to_user, "delegate"),
    ]
    for user, recipient_role in users:
        email = (getattr(user, "email", "") or "").strip()
        if not email:
            continue
        try:
            send_delegation_notification_email(
                to_email=email,
                recipient_name=getattr(user, "full_name", "") or email,
                from_user_name=getattr(rule.from_user, "full_name", "") or rule.from_user.email,
                to_user_name=getattr(rule.to_user, "full_name", "") or rule.to_user.email,
                start_at=timezone.localtime(rule.start_at).strftime("%Y-%m-%d %H:%M"),
                end_at=timezone.localtime(rule.end_at).strftime("%Y-%m-%d %H:%M") if rule.end_at else None,
                reason=rule.reason or None,
                recipient_role=recipient_role,
                action_url=action_url,
            )
        except Exception:
            # Notifications should never break the delegation transaction.
            pass


class HrSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        today = timezone.now().date()
        warning_date = today + timedelta(days=30)

        # 1. Employee Stats
        total_employees = EmployeeProfile.objects.count()
        active_employees = EmployeeProfile.objects.filter(
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE
        ).count()

        # 2. Expiring Documents (next 30 days)
        expiring_docs = EmployeeProfile.objects.filter(
            Q(passport_expiry__range=[today, warning_date])
            | Q(id_expiry__range=[today, warning_date])
            | Q(contract_expiry__range=[today, warning_date])
            | Q(health_card_expiry__range=[today, warning_date])
        ).count()

        # 3. Pending Leave (HR Action)
        pending_leaves_count = LeaveRequest.objects.filter(status=LeaveRequest.RequestStatus.PENDING_HR).count()

        # 4. Pending Approvals List (workflow-backed)
        pending_approvals = []
        for leave_req in LeaveRequest.objects.filter(
            status__in=[
                LeaveRequest.RequestStatus.SUBMITTED,
                LeaveRequest.RequestStatus.PENDING_MANAGER,
                LeaveRequest.RequestStatus.PENDING_HR,
                LeaveRequest.RequestStatus.PENDING_CEO,
                LeaveRequest.RequestStatus.APPROVED,
                LeaveRequest.RequestStatus.REJECTED,
                LeaveRequest.RequestStatus.CANCELLED,
            ]
        )[:50]:
            sync_workflow(leave_req, actor=request.user)
        for record in AttendanceRecord.objects.filter(
            status__in=[
                AttendanceRecord.Status.PENDING,
                AttendanceRecord.Status.PENDING_MANAGER,
                AttendanceRecord.Status.PENDING_HR,
                AttendanceRecord.Status.PENDING_CEO,
                AttendanceRecord.Status.PRESENT,
                AttendanceRecord.Status.REJECTED,
            ]
        )[:50]:
            sync_workflow(record, actor=request.user)
        for loan_req in LoanRequest.objects.filter(
            status__in=[
                LoanRequest.RequestStatus.SUBMITTED,
                LoanRequest.RequestStatus.PENDING_MANAGER,
                LoanRequest.RequestStatus.PENDING_HR,
                LoanRequest.RequestStatus.PENDING_FINANCE,
                LoanRequest.RequestStatus.PENDING_CFO,
                LoanRequest.RequestStatus.PENDING_CEO,
                LoanRequest.RequestStatus.PENDING_DISBURSEMENT,
                LoanRequest.RequestStatus.APPROVED,
                LoanRequest.RequestStatus.REJECTED,
                LoanRequest.RequestStatus.CANCELLED,
            ]
        )[:50]:
            sync_workflow(loan_req, actor=request.user)

        pending_workflows = get_pending_approvals_for_user(request.user, limit=12)
        for workflow in pending_workflows:
            item = build_pending_approval_item(workflow)
            if item:
                pending_approvals.append(item)

        pending_approvals = pending_approvals[:5]

        # 5. Recent Activity (From AuditLogs)
        from audit.models import AuditLog

        recent_activity = []
        # HR dashboard should only show HR manager activity, not system admin activity.
        latest_logs = (
            AuditLog.objects.filter(actor__groups__name="HRManager")
            .select_related("actor")
            .order_by("-created_at")[:10]
        )
        
        for log in latest_logs:
            # Determine the actor name
            actor_name = "System"
            if log.actor:
                profile = getattr(log.actor, "employee_profile", None)
                actor_name = profile.full_name if profile else log.actor.email

            # Determine a nice color and formatted status based on the action/entity
            status_color = "default"
            action_lower = log.action.lower()
            
            if "create" in action_lower or "add" in action_lower or "new" in action_lower:
                status_color = "blue"
            elif "approv" in action_lower or "accept" in action_lower or "success" in action_lower:
                status_color = "green"
            elif "reject" in action_lower or "decline" in action_lower or "fail" in action_lower or "error" in action_lower:
                status_color = "red"
            elif "updat" in action_lower or "edit" in action_lower or "modify" in action_lower:
                status_color = "orange"
            elif "delet" in action_lower or "remove" in action_lower:
                status_color = "volcano"
            elif "login" in action_lower:
                status_color = "cyan"
                
            # Construct a human-readable "status" or "details" string from entity/metadata
            details_str = log.entity
            if log.entity_id:
                details_str += f" (#{log.entity_id})"
            
            # If there's specific metadata we want to highlight, we could add it here
            # But let's keep it simple with just the entity name for now
            if not details_str:
                details_str = "System Action"

            recent_activity.append(
                {
                    "key": f"audit_{log.id}",
                    "employee": actor_name,
                    "action": log.action,
                    "date": log.created_at.strftime("%b %d, %I:%M %p"),
                    "status": details_str,
                    "statusColor": status_color,
                }
            )

        # 6. Latest Payroll Run
        latest_payroll = PayrollRun.objects.order_by("-year", "-month").first()
        payroll_data = {
            "latest_total_net": None,
            "latest_period": None,
            "trend_percentage": None,
        }

        if latest_payroll:
            payroll_data["latest_total_net"] = float(latest_payroll.total_net)
            payroll_data["latest_period"] = f"{latest_payroll.month}/{latest_payroll.year}"

            # Calculate trend vs previous month
            if latest_payroll.month == 1:
                prev_month = 12
                prev_year = latest_payroll.year - 1
            else:
                prev_month = latest_payroll.month - 1
                prev_year = latest_payroll.year

            prev_payroll = PayrollRun.objects.filter(year=prev_year, month=prev_month).first()

            if prev_payroll and prev_payroll.total_net > 0:
                diff = latest_payroll.total_net - prev_payroll.total_net
                trend = (diff / prev_payroll.total_net) * 100
                payroll_data["trend_percentage"] = round(float(trend), 1)

        data = {
            "total_employees": total_employees,
            "active_employees": active_employees,
            "expiring_docs": expiring_docs,
            "pending_leaves": pending_leaves_count,
            "pending_approvals": pending_approvals,
            "recent_activity": recent_activity,
            "latest_payroll": payroll_data,
        }
        return success(data)


class HrRecentActivityView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        qs = AuditLog.objects.filter(actor__groups__name="HRManager").select_related("actor").order_by("-created_at")
        qs = apply_filters(qs, request.query_params)

        paginator = AuditPagination()
        page = paginator.paginate_queryset(qs, request)

        items = []
        for log in page:
            actor_name = "System"
            if log.actor:
                profile = getattr(log.actor, "employee_profile", None)
                actor_name = profile.full_name if profile and profile.full_name else log.actor.email

            status_color = "default"
            action_lower = log.action.lower()

            if "create" in action_lower or "add" in action_lower or "new" in action_lower:
                status_color = "blue"
            elif "approv" in action_lower or "accept" in action_lower or "success" in action_lower:
                status_color = "green"
            elif "reject" in action_lower or "decline" in action_lower or "fail" in action_lower or "error" in action_lower:
                status_color = "red"
            elif "updat" in action_lower or "edit" in action_lower or "modify" in action_lower:
                status_color = "orange"
            elif "delet" in action_lower or "remove" in action_lower:
                status_color = "volcano"
            elif "login" in action_lower:
                status_color = "cyan"

            details_str = log.entity
            if log.entity_id:
                details_str += f" (#{log.entity_id})"
            if not details_str:
                details_str = "System Action"

            items.append(
                {
                    "key": f"audit_{log.id}",
                    "employee": actor_name,
                    "action": log.action,
                    "date": log.created_at.strftime("%b %d, %I:%M %p"),
                    "status": details_str,
                    "statusColor": status_color,
                }
            )

        return paginator.get_paginated_response(items)


class ReportErrorAPIView(APIView):
    """
    Endpoint for frontend to report unhandled errors.
    This will send an email to the system admin.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        message = request.data.get("message", "Unknown error")
        stack = request.data.get("stack", "No stack trace provided")
        url = request.data.get("url", "Unknown URL")
        
        user_info = "Anonymous/Unauthenticated User"
        if request.user.is_authenticated:
            user_info = f"User: {request.user.email} (Role: {request.user.role})"

        email_subject = f"[FFISYS Error Report] Error at {url}"
        email_body = f"""
An error was reported from the frontend application:

URL: {url}
Reported By: {user_info}
Time: {timezone.now().strftime("%Y-%m-%d %H:%M:%S UTC")}

Message:
{message}

Stack Trace:
{stack}
"""

        try:
            admin_email = getattr(settings, "ADMIN_EMAIL", "admin@ffisystem.com")
            # If deploying, make sure you configure EMAIL_HOST_USER or DEFAULT_FROM_EMAIL
            from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@ffisystem.com")
            
            send_mail(
                subject=email_subject,
                message=email_body,
                from_email=from_email,
                recipient_list=[admin_email],
                fail_silently=False,
            )
            return success({"detail": "Error reported successfully."})
        except Exception as e:
            return Response({"detail": f"Failed to send error report: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DelegationRuleListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        queryset = DelegationRule.objects.select_related("from_user", "to_user", "created_by")
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            queryset = queryset.filter(Q(from_user=request.user) | Q(to_user=request.user))
        data = DelegationRuleSerializer(queryset.order_by("-updated_at", "-id"), many=True).data
        return success({"items": data})

    def post(self, request):
        serializer = DelegationRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from_user = serializer.validated_data["from_user"]
        if get_role(request.user) not in {"HRManager", "SystemAdmin"} and from_user != request.user:
            raise PermissionDenied("You can only create delegation rules for your own approvals.")

        with transaction.atomic():
            rule = serializer.save(created_by=request.user)
            audit(
                request,
                "delegation_rule_created",
                entity="delegation_rule",
                entity_id=rule.id,
                metadata={
                    "from_user_id": rule.from_user_id,
                    "to_user_id": rule.to_user_id,
                    "is_active": rule.is_active,
                },
            )
            transaction.on_commit(lambda rule_id=rule.id: _safe_send_delegation_emails(DelegationRule.objects.get(pk=rule_id)))
        return success(DelegationRuleSerializer(rule).data, status=201)


class DelegationRuleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_rule(self, request, pk):
        try:
            rule = DelegationRule.objects.select_related("from_user", "to_user", "created_by").get(pk=pk)
        except DelegationRule.DoesNotExist:
            raise NotFound("Delegation rule not found.")

        if get_role(request.user) in {"HRManager", "SystemAdmin"}:
            return rule
        if request.user.id not in {rule.from_user_id, rule.to_user_id}:
            raise PermissionDenied("You do not have access to this delegation rule.")
        return rule

    def patch(self, request, pk):
        rule = self._get_rule(request, pk)
        if get_role(request.user) not in {"HRManager", "SystemAdmin"} and rule.from_user_id != request.user.id:
            raise PermissionDenied("You can only update delegation rules you created for yourself.")

        serializer = DelegationRuleSerializer(rule, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        from_user = serializer.validated_data.get("from_user", rule.from_user)
        if get_role(request.user) not in {"HRManager", "SystemAdmin"} and from_user != request.user:
            raise PermissionDenied("You can only delegate your own approvals.")

        with transaction.atomic():
            updated_rule = serializer.save()
            audit(
                request,
                "delegation_rule_updated",
                entity="delegation_rule",
                entity_id=updated_rule.id,
                metadata={
                    "from_user_id": updated_rule.from_user_id,
                    "to_user_id": updated_rule.to_user_id,
                    "is_active": updated_rule.is_active,
                },
            )
        return success(DelegationRuleSerializer(updated_rule).data)

    def delete(self, request, pk):
        rule = self._get_rule(request, pk)
        if get_role(request.user) not in {"HRManager", "SystemAdmin"} and rule.from_user_id != request.user.id:
            raise PermissionDenied("You can only delete delegation rules you created for yourself.")

        rule_id = rule.id
        metadata = {
            "from_user_id": rule.from_user_id,
            "to_user_id": rule.to_user_id,
            "is_active": rule.is_active,
        }
        with transaction.atomic():
            rule.delete()
            audit(request, "delegation_rule_deleted", entity="delegation_rule", entity_id=rule_id, metadata=metadata)
        return success(message="Delegation rule deleted.")


class UserPreferenceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, scope, key):
        preference = UserPreference.objects.filter(user=request.user, scope=scope, key=key).first()
        if preference is None:
            return success(
                {
                    "scope": scope,
                    "key": key,
                    "value": {},
                    "created_at": None,
                    "updated_at": None,
                }
            )
        return success(UserPreferenceSerializer(preference).data)

    def put(self, request, scope, key):
        preference = UserPreference.objects.filter(user=request.user, scope=scope, key=key).first()
        serializer = UserPreferenceSerializer(preference, data={"scope": scope, "key": key, **request.data})
        serializer.is_valid(raise_exception=True)
        saved = serializer.save(user=request.user)
        audit(
            request,
            "user_preference_saved",
            entity="user_preference",
            entity_id=saved.id,
            metadata={"scope": saved.scope, "key": saved.key},
        )
        return success(UserPreferenceSerializer(saved).data)
