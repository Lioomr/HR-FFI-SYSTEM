import logging
from collections import Counter, defaultdict
from datetime import timedelta
from html import escape

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import FieldDoesNotExist
from django.db import transaction
from django.db.models import Count, Q, prefetch_related_objects
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from assets.models import AssetReturnRequest
from attendance.models import AttendanceCorrectionRequest, AttendanceRecord
from audit.models import AuditLog
from audit.utils import audit
from audit.views import AuditPagination, apply_filters
from core.permissions import IsDepartmentCEOApprover, IsHRManagerOrAdmin
from core.response_cache import build_cache_key, get_cached_response_data, set_cached_response_data
from core.responses import error, success
from core.serializers import (
    CrossCompanyManagerAssignmentSerializer,
    DelegationRuleSerializer,
    OrganizationScopeSerializer,
    RequestObligationSerializer,
    UserPreferenceSerializer,
)
from core.services import (
    build_pending_approval_item,
    get_pending_approvals_for_user,
    send_delegation_notification_email,
    sync_leave_obligations,
    sync_workflow,
)
from core.services.workflow_engine import cached_workflow_definitions
from core.tasks import send_error_report_email
from employees.models import EmployeeDeletionRequest, EmployeeProfile
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest
from loans.models import LoanRequest
from organization.models import OrganizationNode, OrganizationScope
from organization.services import (
    filter_queryset_by_accessible_companies,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
    get_user_accessible_company_ids,
)
from payroll.models import PayrollRun

from .models import CrossCompanyManagerAssignment, DelegationRule, RequestObligation, UserPreference, WorkflowInstance
from .permissions import get_role

logger = logging.getLogger(__name__)


def _display_datetime(value):
    if not value:
        return None
    tzinfo = getattr(settings, "EMAIL_DISPLAY_TZINFO", None)
    return timezone.localtime(value, tzinfo) if tzinfo else timezone.localtime(value)


class PendingRequestsPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    page_query_param = "page"
    max_page_size = 100

    def get_paginated_response(self, data, **extra):
        return success(
            {
                "items": data,
                "page": self.page.number,
                "page_size": self.get_page_size(self.request),
                "count": self.page.paginator.count,
                "total_pages": self.page.paginator.num_pages,
                **extra,
            }
        )


def _safe_send_delegation_emails(rule: DelegationRule):
    from in_app_notifications.dispatcher import dispatch_notification_channels
    from in_app_notifications.models import Notification

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
    from in_app_notifications.i18n import notification_text

    delegation_text = notification_text(
        "delegation.assigned", from_user=str(rule.from_user), to_user=str(rule.to_user)
    )
    for user, recipient_role in users:
        dispatch_notification_channels(
            recipient=user,
            event_key="delegation.assigned",
            **delegation_text,
            category=Notification.Category.DELEGATION,
            action_url=role_route,
            related_object=rule,
            metadata={"recipient_role": recipient_role},
            deduplication_key=f"delegation.assigned:{rule.id}:{recipient_role}",
            email_template=send_delegation_notification_email,
            email_context={
                "recipient_name": getattr(user, "full_name", "") or getattr(user, "email", ""),
                "from_user_name": getattr(rule.from_user, "full_name", "") or rule.from_user.email,
                "to_user_name": getattr(rule.to_user, "full_name", "") or rule.to_user.email,
                "start_at": timezone.localtime(rule.start_at).strftime("%Y-%m-%d %H:%M"),
                "end_at": timezone.localtime(rule.end_at).strftime("%Y-%m-%d %H:%M") if rule.end_at else None,
                "reason": rule.reason or None,
                "recipient_role": recipient_role,
                "action_url": action_url,
            },
        )


def _sync_pending_request_workflows_for_request(request, *, limit_per_type: int | None = None) -> set[tuple[str, int]]:
    """Sync the workflow of every pending record in scope; return the records synced."""
    synced: set[tuple[str, int]] = set()

    def _sync(instance):
        sync_workflow(instance, actor=request.user)
        synced.add(_workflow_object_key(instance))

    def _maybe_limit(queryset):
        if limit_per_type is None:
            return queryset.iterator(chunk_size=200)
        return queryset[:limit_per_type]

    leave_statuses = [
        LeaveRequest.RequestStatus.SUBMITTED,
        LeaveRequest.RequestStatus.PENDING_DELEGATE,
        LeaveRequest.RequestStatus.PENDING_MANAGER,
        LeaveRequest.RequestStatus.PENDING_HR,
        LeaveRequest.RequestStatus.PENDING_CEO,
        LeaveRequest.RequestStatus.PENDING_HR_COMPLETION,
    ]
    leave_qs = (
        filter_queryset_by_company_scope(LeaveRequest.objects.all(), request)
        .filter(status__in=leave_statuses)
        .order_by("-updated_at", "-id")
    )
    for leave_req in _maybe_limit(leave_qs):
        _sync(leave_req)

    payment_qs = (
        filter_queryset_by_company_scope(AnnualLeavePaymentRequest.objects.all(), request)
        .filter(
            status__in=[
                AnnualLeavePaymentRequest.Status.PENDING_HR,
                AnnualLeavePaymentRequest.Status.PENDING_CEO,
            ]
        )
        .order_by("-submitted_at", "-id")
    )
    for payment in _maybe_limit(payment_qs):
        _sync(payment)

    attendance_statuses = [
        AttendanceRecord.Status.PENDING,
        AttendanceRecord.Status.PENDING_MANAGER,
        AttendanceRecord.Status.PENDING_HR,
        AttendanceRecord.Status.PENDING_CEO,
    ]
    attendance_qs = (
        filter_queryset_by_company_scope(
            AttendanceRecord.objects.all(),
            request,
            field_name="employee_profile__company_id",
        )
        .filter(status__in=attendance_statuses)
        .order_by("-updated_at", "-id")
    )
    for record in _maybe_limit(attendance_qs):
        _sync(record)

    correction_statuses = [
        AttendanceCorrectionRequest.Status.PENDING_MANAGER,
        AttendanceCorrectionRequest.Status.PENDING_HR,
    ]
    correction_qs = (
        filter_queryset_by_company_scope(
            AttendanceCorrectionRequest.objects.all(),
            request,
            field_name="employee_profile__company_id",
        )
        .filter(status__in=correction_statuses)
        .order_by("-updated_at", "-id")
    )
    for correction in _maybe_limit(correction_qs):
        _sync(correction)

    loan_statuses = [
        LoanRequest.RequestStatus.SUBMITTED,
        LoanRequest.RequestStatus.PENDING_MANAGER,
        LoanRequest.RequestStatus.PENDING_HR,
        LoanRequest.RequestStatus.PENDING_FINANCE,
        LoanRequest.RequestStatus.PENDING_CFO,
        LoanRequest.RequestStatus.PENDING_CEO,
        LoanRequest.RequestStatus.PENDING_DISBURSEMENT,
    ]
    loan_qs = (
        filter_queryset_by_company_scope(LoanRequest.objects.all(), request)
        .filter(status__in=loan_statuses)
        .order_by("-updated_at", "-id")
    )
    for loan_req in _maybe_limit(loan_qs):
        _sync(loan_req)

    asset_return_statuses = [
        AssetReturnRequest.RequestStatus.PENDING_MANAGER,
        AssetReturnRequest.RequestStatus.PENDING,
        AssetReturnRequest.RequestStatus.PENDING_CEO,
    ]
    asset_return_qs = (
        filter_queryset_by_company_scope(
            AssetReturnRequest.objects.select_related("asset"),
            request,
            field_name="asset__company_id",
        )
        .filter(status__in=asset_return_statuses)
        .order_by("-requested_at", "-id")
    )
    for return_req in _maybe_limit(asset_return_qs):
        _sync(return_req)

    deletion_qs = (
        filter_queryset_by_company_scope(EmployeeDeletionRequest.objects.all(), request)
        .filter(
            status__in=[
                EmployeeDeletionRequest.Status.PENDING_CEO,
            ]
        )
        .order_by("-updated_at", "-id")
    )
    for deletion_req in _maybe_limit(deletion_qs):
        _sync(deletion_req)
    return synced


def _workflow_object_key(instance) -> tuple[str, int]:
    return (instance._meta.label, instance.pk)


def _is_dashboard_object_in_active_scope(obj, active_company) -> bool:
    workflow_company_id = _get_company_id_for_dashboard_object(obj)
    return bool(active_company and workflow_company_id == active_company.id)


def _build_pending_request_items_for_request(request, *, limit: int | None = None) -> list[dict]:
    with cached_workflow_definitions():
        return _collect_pending_request_items(request, limit=limit)


def _prefetch_employee_profiles(content_objects) -> None:
    """Batch-load ``employee_profile`` for every record type that has that relation."""
    by_model = defaultdict(list)
    for obj in content_objects:
        by_model[type(obj)].append(obj)
    for model, objects in by_model.items():
        try:
            field = model._meta.get_field("employee_profile")
        except FieldDoesNotExist:
            continue
        if field.is_relation and field.many_to_one:
            prefetch_related_objects(objects, "employee_profile")


def _collect_pending_request_items(request, *, limit: int | None) -> list[dict]:
    already_synced = _sync_pending_request_workflows_for_request(request)
    # Resolved once: it costs several queries and is the same for every item.
    active_company = get_active_company_for_request(request)
    items = []
    workflows = get_pending_approvals_for_user(request.user, limit=limit)
    # One query per request type instead of one per workflow.
    prefetch_related_objects(workflows, "content_object")
    _prefetch_employee_profiles([workflow.content_object for workflow in workflows if workflow.content_object])
    for workflow in workflows:
        content_object = workflow.content_object
        if content_object is None or not _is_dashboard_object_in_active_scope(content_object, active_company):
            continue
        # Records the pre-sync just handled are current (and this workflow row
        # was read after it); re-syncing them would only repeat the same work.
        if _workflow_object_key(content_object) not in already_synced:
            workflow = sync_workflow(content_object, actor=request.user)
            # Keep the already-loaded record on the refreshed workflow row.
            workflow.content_object = content_object
        if workflow.status not in {WorkflowInstance.Status.SUBMITTED, WorkflowInstance.Status.IN_REVIEW}:
            continue
        item = build_pending_approval_item(workflow, language=getattr(request, "LANGUAGE_CODE", "en"))
        if not item:
            continue
        # Only objects in the active company reach this point.
        item["company_name"] = active_company.name
        items.append(item)
    items.sort(key=lambda item: item.get("time") or "", reverse=True)
    return items


class PendingRequestsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = _build_pending_request_items_for_request(request, limit=None)

        request_type = (request.query_params.get("request_type") or "").strip().upper()

        search = (request.query_params.get("search") or "").strip().lower()
        if search:
            items = [
                item
                for item in items
                if search in (item.get("name") or "").lower()
                or search in (item.get("action") or "").lower()
                or search in (item.get("request_type_label") or "").lower()
                or search in (item.get("details") or "").lower()
            ]

        # Counted before the type filter so every type keeps its count while
        # the inbox is filtered to one of them.
        counts_by_type = dict(Counter(item["request_type"] for item in items))
        total_count = len(items)

        if request_type:
            items = [item for item in items if item["request_type"] == request_type]

        paginator = PendingRequestsPagination()
        page = paginator.paginate_queryset(items, request)
        return paginator.get_paginated_response(
            page, counts_by_type=counts_by_type, total_count=total_count
        )


def _build_workforce_status(employee_qs):
    """Where the workforce is today, for the HR dashboard's status chart.

    Active, non-archived employees are split by approved leave covering today:
    leave marked as travel counts as outside the country and any other leave
    as inside the country, whatever the leave type; everyone else is currently
    employed. Pre-hire and suspended employees are deliberately left out.
    """
    today = timezone.localdate()
    active_ids = set(
        employee_qs.filter(
            is_archived=False,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        ).values_list("id", flat=True)
    )
    leaves_today = LeaveRequest.objects.filter(
        status=LeaveRequest.RequestStatus.APPROVED,
        is_active=True,
        start_date__lte=today,
        end_date__gte=today,
    ).filter(Q(employee_profile_id__in=active_ids) | Q(employee__employee_profile__id__in=active_ids))

    outside_ids, inside_ids = set(), set()
    for leave in leaves_today.values("employee_profile_id", "employee__employee_profile__id", "will_travel"):
        profile_id = leave["employee_profile_id"] or leave["employee__employee_profile__id"]
        if profile_id not in active_ids:
            continue
        (outside_ids if leave["will_travel"] else inside_ids).add(profile_id)
    # Travelling wins when an employee has overlapping leaves today.
    inside_ids -= outside_ids

    return {
        "currently_employed": len(active_ids - outside_ids - inside_ids),
        "on_leave_outside": len(outside_ids),
        "on_leave_inside": len(inside_ids),
        "archived": employee_qs.filter(is_archived=True).count(),
    }


def _build_nationality_breakdown(employee_qs):
    """Headcount per nationality for non-archived employees, largest first.

    Nationality is free text (imports produce "pakistan" and "Pakistan "), so
    values are grouped case- and whitespace-insensitively; blanks come back as
    ``None`` and sort last.
    """
    groups = {}
    rows = (
        employee_qs.filter(is_archived=False)
        .order_by()
        .values("nationality", "nationality_en", "is_saudi", "employment_status")
        .annotate(count=Count("id"))
    )
    for row in rows:
        name = " ".join((row["nationality"] or row["nationality_en"] or "").split())
        key = name.casefold() or None
        group = groups.setdefault(
            key,
            {"nationality": name.title() if name else None, "total": 0, "active": 0, "is_saudi": False},
        )
        group["total"] += row["count"]
        if row["employment_status"] == EmployeeProfile.EmploymentStatus.ACTIVE:
            group["active"] += row["count"]
        group["is_saudi"] = group["is_saudi"] or row["is_saudi"]

    nationalities = sorted(
        groups.values(),
        key=lambda group: (group["nationality"] is None, -group["total"], group["nationality"] or ""),
    )
    saudi_active = employee_qs.filter(
        is_archived=False, is_saudi=True, employment_status=EmployeeProfile.EmploymentStatus.ACTIVE
    ).count()
    return {
        "saudi_active": saudi_active,
        "active_total": sum(group["active"] for group in nationalities),
        "nationalities": nationalities,
    }


EXPIRING_DOCUMENTS_WINDOW_DAYS = 30
EXPIRING_DOCUMENTS_PREVIEW_SIZE = 5
# Same fields and window as the expiring-documents page (employees/views.py
# ``expiries``); the ID card is split into National ID (Saudi) and Iqama, and
# the health card is what HR tracks as health insurance.
_EXPIRY_FIELDS = [
    ("id_expiry", None),
    ("passport_expiry", "passport"),
    ("work_license_expiry", "work_license"),
    ("health_card_expiry", "health_insurance"),
    ("contract_expiry", "contract"),
]


def _build_expiring_documents(employee_qs):
    """Documents of non-archived employees expiring within the next 30 days."""
    today = timezone.localdate()
    cutoff = today + timedelta(days=EXPIRING_DOCUMENTS_WINDOW_DAYS)
    window = Q()
    for field, _doc_type in _EXPIRY_FIELDS:
        window |= Q(**{f"{field}__range": [today, cutoff]})
    profiles = employee_qs.filter(window, is_archived=False).values(
        "id", "full_name", "is_saudi", *[field for field, _doc_type in _EXPIRY_FIELDS]
    )

    by_type = {
        "national_id": 0,
        "iqama": 0,
        "passport": 0,
        "work_license": 0,
        "contract": 0,
        "health_insurance": 0,
    }
    documents = []
    employee_ids = set()
    for profile in profiles:
        for order, (field, doc_type) in enumerate(_EXPIRY_FIELDS):
            expiry_date = profile[field]
            if not expiry_date or not today <= expiry_date <= cutoff:
                continue
            if doc_type is None:
                doc_type = "national_id" if profile["is_saudi"] else "iqama"
            by_type[doc_type] += 1
            employee_ids.add(profile["id"])
            documents.append(
                (
                    (expiry_date - today).days,
                    profile["full_name"] or "",
                    order,
                    {
                        "employee_id": profile["id"],
                        "full_name": profile["full_name"],
                        "doc_type": doc_type,
                        "expiry_date": expiry_date.isoformat(),
                        "days_left": (expiry_date - today).days,
                    },
                )
            )
    documents.sort(key=lambda item: item[:3])
    return {
        "window_days": EXPIRING_DOCUMENTS_WINDOW_DAYS,
        "employee_count": len(employee_ids),
        "by_type": by_type,
        "soonest": [item[3] for item in documents[:EXPIRING_DOCUMENTS_PREVIEW_SIZE]],
    }


class HrSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        active_company = get_active_company_for_request(request)

        # Identical for every HRManager/SystemAdmin viewing the same active
        # company at the same moment (see module docstring in
        # core/response_cache.py) -- so a company-scoped cache key is safe.
        # No active company selected -> nothing consistent to key on, so
        # always compute fresh rather than risk a wrong/shared cache entry.
        cache_key = None
        if active_company is not None:
            cache_key = build_cache_key("hr_summary", "company", active_company.id)
            cached = get_cached_response_data(cache_key)
            if cached is not None:
                return success(cached)

        employee_qs = filter_queryset_by_company_scope(EmployeeProfile.objects.all(), request)
        leave_qs = filter_queryset_by_company_scope(LeaveRequest.objects.all(), request)
        payroll_qs = filter_queryset_by_company_scope(PayrollRun.objects.all(), request)

        hr_activity_filter = Q(
            actor__groups__name="HRManager",
            actor__employee_profile__company_id=getattr(active_company, "id", None),
        )

        # 1. Employee Stats
        total_employees = employee_qs.count()
        active_employees = employee_qs.filter(employment_status=EmployeeProfile.EmploymentStatus.ACTIVE).count()
        workforce_status = _build_workforce_status(employee_qs)
        nationality_breakdown = _build_nationality_breakdown(employee_qs)

        # 2. Expiring Documents (next 30 days)
        expiring_documents = _build_expiring_documents(employee_qs)
        expiring_docs = expiring_documents["employee_count"]

        # 3. Pending Leave (HR Action)
        pending_leaves_count = leave_qs.filter(status=LeaveRequest.RequestStatus.PENDING_HR).count()

        # 4. Recent Activity (From AuditLogs)
        from audit.models import AuditLog

        recent_activity = []
        # HR dashboard should only show HR manager activity, not system admin activity.
        latest_logs = AuditLog.objects.filter(hr_activity_filter).select_related("actor").order_by("-created_at")[:10]

        for log in latest_logs:
            # Determine the actor name
            actor_name = "System"
            profile = None
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
            elif (
                "reject" in action_lower
                or "decline" in action_lower
                or "fail" in action_lower
                or "error" in action_lower
            ):
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
                    "date": _display_datetime(log.created_at).strftime("%b %d, %I:%M %p"),
                    "status": details_str,
                    "statusColor": status_color,
                    "company_name": getattr(getattr(profile, "company", None), "name", None) if log.actor else None,
                }
            )

        # 5. Latest Payroll Run
        latest_payroll = payroll_qs.order_by("-year", "-month").first()
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

            prev_payroll = payroll_qs.filter(year=prev_year, month=prev_month).first()

            if prev_payroll and prev_payroll.total_net > 0:
                diff = latest_payroll.total_net - prev_payroll.total_net
                trend = (diff / prev_payroll.total_net) * 100
                payroll_data["trend_percentage"] = round(float(trend), 1)

        data = {
            "total_employees": total_employees,
            "active_employees": active_employees,
            "workforce_status": workforce_status,
            "nationality_breakdown": nationality_breakdown,
            "expiring_docs": expiring_docs,
            "expiring_documents": expiring_documents,
            "pending_leaves": pending_leaves_count,
            "recent_activity": recent_activity,
            "latest_payroll": payroll_data,
        }
        if cache_key is not None:
            set_cached_response_data(cache_key, data, settings.HR_SUMMARY_CACHE_SECONDS)
        return success(data)


class HrRecentActivityView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        active_company = get_active_company_for_request(request)
        company_filter = Q(actor__employee_profile__company_id=getattr(active_company, "id", None))

        qs = (
            AuditLog.objects.filter(actor__groups__name="HRManager")
            .filter(company_filter)
            .select_related("actor")
            .order_by("-created_at")
        )
        qs = apply_filters(qs, request.query_params)

        paginator = AuditPagination()
        page = paginator.paginate_queryset(qs, request)

        items = []
        for log in page:
            actor_name = "System"
            profile = None
            if log.actor:
                profile = getattr(log.actor, "employee_profile", None)
                actor_name = profile.full_name if profile and profile.full_name else log.actor.email

            status_color = "default"
            action_lower = log.action.lower()

            if "create" in action_lower or "add" in action_lower or "new" in action_lower:
                status_color = "blue"
            elif "approv" in action_lower or "accept" in action_lower or "success" in action_lower:
                status_color = "green"
            elif (
                "reject" in action_lower
                or "decline" in action_lower
                or "fail" in action_lower
                or "error" in action_lower
            ):
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
                    "date": _display_datetime(log.created_at).strftime("%b %d, %I:%M %p"),
                    "status": details_str,
                    "statusColor": status_color,
                    "company_name": getattr(getattr(profile, "company", None), "name", None) if log.actor else None,
                }
            )

        return paginator.get_paginated_response(items)


def _get_company_id_for_dashboard_object(obj):
    direct_company_id = getattr(obj, "company_id", None)
    if direct_company_id:
        return direct_company_id

    asset = getattr(obj, "asset", None)
    if asset and getattr(asset, "company_id", None):
        return asset.company_id

    employee_profile = getattr(obj, "employee_profile", None)
    if employee_profile and getattr(employee_profile, "company_id", None):
        return employee_profile.company_id

    employee = getattr(obj, "employee", None)
    if employee and getattr(employee, "company_id", None):
        return employee.company_id

    employee_profile = getattr(employee, "employee_profile", None) if employee else None
    if employee_profile and getattr(employee_profile, "company_id", None):
        return employee_profile.company_id

    return None


ERROR_REPORT_MAX_MESSAGE_CHARS = 1000
ERROR_REPORT_MAX_STACK_CHARS = 8000
ERROR_REPORT_MAX_URL_CHARS = 500


def _clean_error_report_field(value, *, max_chars, fallback):
    """Reports arrive unauthenticated, so coerce, trim and bound every field."""
    if value is None:
        return fallback
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return fallback
    if len(value) > max_chars:
        return f"{value[:max_chars]}... [truncated]"
    return value


class ReportErrorAPIView(APIView):
    """Accept unhandled frontend errors and queue an admin notification email.

    The endpoint stays public so crashes on unauthenticated screens still reach
    us, which makes the scoped throttle and the field length caps the only things
    between a caller and the admin mailbox. Delivery is handed to Celery so a slow
    or failing provider cannot tie up a request worker, and provider errors are
    logged server-side instead of being echoed back to the caller.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "error_report"

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        message = _clean_error_report_field(
            data.get("message"), max_chars=ERROR_REPORT_MAX_MESSAGE_CHARS, fallback="Unknown error"
        )
        stack = _clean_error_report_field(
            data.get("stack"), max_chars=ERROR_REPORT_MAX_STACK_CHARS, fallback="No stack trace provided"
        )
        url = _clean_error_report_field(data.get("url"), max_chars=ERROR_REPORT_MAX_URL_CHARS, fallback="Unknown URL")

        user_info = "Anonymous/Unauthenticated User"
        if request.user.is_authenticated:
            user_info = f"User: {request.user.email} (Role: {get_role(request.user)})"

        # Collapse whitespace so a newline in the URL cannot inject email headers.
        email_subject = f"[FFISYS Error Report] Error at {' '.join(url.split())}"
        reported_at = timezone.now().strftime("%Y-%m-%d %H:%M:%S UTC")
        text_body = f"""An error was reported from the frontend application:

URL: {url}
Reported By: {user_info}
Time: {reported_at}

Message:
{message}

Stack Trace:
{stack}
"""
        # Caller-controlled text is escaped before it reaches an admin inbox.
        html_body = f"<pre>{escape(text_body)}</pre>"

        # Logged before dispatch so the report survives an email or broker outage.
        logger.warning("frontend_error_report", extra={"report_url": url, "reported_by": user_info})

        try:
            send_error_report_email.delay(email_subject, text_body, html_body)
        except Exception:
            logger.exception("error_report_email_enqueue_failed")
            return error(message="Failed to send error report.", status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return success({"detail": "Error reported successfully."})


class DelegationRuleListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        queryset = DelegationRule.objects.select_related("from_user", "to_user", "created_by")
        if get_role(request.user) in {"HRManager", "SystemAdmin"}:
            queryset = filter_queryset_by_company_scope(
                queryset,
                request,
                field_name="from_user__employee_profile__company_id",
            )
        else:
            queryset = queryset.filter(Q(from_user=request.user) | Q(to_user=request.user))
        data = DelegationRuleSerializer(
            queryset.order_by("-updated_at", "-id"),
            many=True,
            context={"request": request},
        ).data
        return success({"items": data})

    def post(self, request):
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            try:
                requested_from_user_id = int(request.data.get("from_user_id"))
            except (TypeError, ValueError):
                requested_from_user_id = None
            if requested_from_user_id != request.user.id:
                raise PermissionDenied("You can only create delegation rules for your own approvals.")

        serializer = DelegationRuleSerializer(data=request.data, context={"request": request})
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
            transaction.on_commit(
                lambda rule_id=rule.id: _safe_send_delegation_emails(DelegationRule.objects.get(pk=rule_id))
            )
        return success(DelegationRuleSerializer(rule).data, status=201)


class DelegationRuleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_rule(self, request, pk):
        try:
            queryset = DelegationRule.objects.select_related("from_user", "to_user", "created_by")
            if get_role(request.user) in {"HRManager", "SystemAdmin"}:
                queryset = filter_queryset_by_company_scope(
                    queryset,
                    request,
                    field_name="from_user__employee_profile__company_id",
                )
            else:
                queryset = queryset.filter(Q(from_user=request.user) | Q(to_user=request.user))
            rule = queryset.get(pk=pk)
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

        serializer = DelegationRuleSerializer(
            rule,
            data=request.data,
            partial=True,
            context={"request": request},
        )
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

        with transaction.atomic():
            rule.is_active = False
            rule.revoked_at = timezone.now()
            rule.revoked_by = request.user
            rule.save(update_fields=["is_active", "revoked_at", "revoked_by", "updated_at"])
            audit(
                request,
                "delegation_rule_revoked",
                entity="delegation_rule",
                entity_id=rule.id,
                metadata={"from_user_id": rule.from_user_id, "to_user_id": rule.to_user_id},
            )
        return success(message="Delegation rule revoked.")


class OrganizationScopeListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _queryset(self, request):
        role = get_role(request.user)
        queryset = OrganizationScope.objects.prefetch_related("memberships__company")
        if role == "SystemAdmin":
            return queryset
        if role == "HRManager":
            # HRManagers administer only scopes entirely covered by their
            # organization-access entries; SystemAdmin remains the audit role.
            allowed_company_ids = get_user_accessible_company_ids(request.user)
            unavailable_company_ids = OrganizationNode.objects.filter(
                node_type=OrganizationNode.NodeType.COMPANY,
                is_active=True,
            ).exclude(pk__in=allowed_company_ids)
            return (
                queryset.filter(memberships__company_id__in=allowed_company_ids)
                .exclude(memberships__company_id__in=unavailable_company_ids)
                .distinct()
            )

        from core.delegation import get_current_scope_ids_for_user

        return queryset.filter(pk__in=get_current_scope_ids_for_user(request.user), is_active=True)

    @staticmethod
    def _validate_scope_companies(request, serializer, existing_scope=None):
        if get_role(request.user) == "SystemAdmin":
            return
        requested_company_ids = serializer.validated_data.get("company_ids")
        if requested_company_ids is None and existing_scope is not None:
            requested_company_ids = list(existing_scope.memberships.values_list("company_id", flat=True))
        if requested_company_ids is None:
            return
        allowed_company_ids = get_user_accessible_company_ids(request.user)
        if not set(requested_company_ids).issubset(allowed_company_ids):
            raise PermissionDenied("HRManager can only administer scopes covered by authorized companies.")

    def get(self, request):
        return success({"items": OrganizationScopeSerializer(self._queryset(request), many=True).data})

    def post(self, request):
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            raise PermissionDenied("Only HRManager or SystemAdmin can create organization scopes.")
        serializer = OrganizationScopeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._validate_scope_companies(request, serializer)
        with transaction.atomic():
            scope = serializer.save(created_by=request.user)
            audit(
                request,
                "organization_scope_created",
                entity="organization_scope",
                entity_id=scope.id,
                metadata={"company_ids": list(scope.memberships.values_list("company_id", flat=True))},
            )
        return success(OrganizationScopeSerializer(scope).data, status=201)


class OrganizationScopeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_scope(self, request, pk):
        try:
            return OrganizationScopeListCreateView()._queryset(request).get(pk=pk)
        except OrganizationScope.DoesNotExist as exc:
            raise NotFound("Organization scope not found.") from exc

    def get(self, request, pk):
        return success(OrganizationScopeSerializer(self._get_scope(request, pk)).data)

    def patch(self, request, pk):
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            raise PermissionDenied("Only HRManager or SystemAdmin can change organization scopes.")
        scope = self._get_scope(request, pk)
        serializer = OrganizationScopeSerializer(scope, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        OrganizationScopeListCreateView._validate_scope_companies(request, serializer, scope)
        with transaction.atomic():
            updated_scope = serializer.save()
            audit(
                request,
                "organization_scope_updated",
                entity="organization_scope",
                entity_id=updated_scope.id,
                metadata={"company_ids": list(updated_scope.memberships.values_list("company_id", flat=True))},
            )
        return success(OrganizationScopeSerializer(updated_scope).data)


class CrossCompanyManagerAssignmentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        queryset = CrossCompanyManagerAssignment.objects.select_related(
            "employee", "manager_profile", "scope", "created_by", "revoked_by"
        )
        role = get_role(request.user)
        if role == "HRManager":
            scope_ids = OrganizationScopeListCreateView()._queryset(request).values_list("id", flat=True)
            queryset = queryset.filter(scope_id__in=scope_ids)
        elif role != "SystemAdmin":
            from employees.services.manager_relationships import active_cross_company_manager_assignments

            queryset = active_cross_company_manager_assignments(
                request.user,
                capability=CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
            )
        return success({"items": CrossCompanyManagerAssignmentSerializer(queryset, many=True).data})

    def post(self, request):
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            raise PermissionDenied("Only HRManager or SystemAdmin can create cross-company manager assignments.")
        serializer = CrossCompanyManagerAssignmentSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            assignment = serializer.save(created_by=request.user)
            audit(
                request,
                "cross_company_manager_assignment_created",
                entity="cross_company_manager_assignment",
                entity_id=assignment.id,
                metadata={
                    "employee_profile_id": assignment.employee_id,
                    "manager_profile_id": assignment.manager_profile_id,
                    "scope_id": assignment.scope_id,
                },
            )
        return success(CrossCompanyManagerAssignmentSerializer(assignment).data, status=201)


class CrossCompanyManagerAssignmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_assignment(self, request, pk):
        queryset = CrossCompanyManagerAssignment.objects.select_related(
            "employee", "manager_profile", "scope", "created_by", "revoked_by"
        )
        role = get_role(request.user)
        if role == "HRManager":
            scope_ids = OrganizationScopeListCreateView()._queryset(request).values_list("id", flat=True)
            queryset = queryset.filter(scope_id__in=scope_ids)
        elif role != "SystemAdmin":
            from employees.services.manager_relationships import active_cross_company_manager_assignments

            queryset = active_cross_company_manager_assignments(
                request.user,
                capability=CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
            )
        try:
            return queryset.get(pk=pk)
        except CrossCompanyManagerAssignment.DoesNotExist as exc:
            raise NotFound("Cross-company manager assignment not found.") from exc

    def patch(self, request, pk):
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            raise PermissionDenied("Only HRManager or SystemAdmin can change cross-company manager assignments.")
        assignment = self._get_assignment(request, pk)
        serializer = CrossCompanyManagerAssignmentSerializer(
            assignment, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        updated_assignment = serializer.save()
        audit(
            request,
            "cross_company_manager_assignment_updated",
            entity="cross_company_manager_assignment",
            entity_id=updated_assignment.id,
        )
        return success(CrossCompanyManagerAssignmentSerializer(updated_assignment).data)

    def delete(self, request, pk):
        if get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            raise PermissionDenied("Only HRManager or SystemAdmin can revoke cross-company manager assignments.")
        assignment = self._get_assignment(request, pk)
        assignment.is_active = False
        assignment.revoked_at = timezone.now()
        assignment.revoked_by = request.user
        assignment.save(update_fields=["is_active", "revoked_at", "revoked_by", "updated_at"])
        audit(
            request,
            "cross_company_manager_assignment_revoked",
            entity="cross_company_manager_assignment",
            entity_id=assignment.id,
        )
        return success(message="Cross-company manager assignment revoked.")


def _resolve_obligation_parent(parent_type: str, parent_id: str):
    if parent_type != "leave_request":
        raise NotFound("Unsupported parent_type.")
    try:
        return LeaveRequest.objects.select_related("employee", "employee_profile", "leave_type", "company").get(
            pk=parent_id,
            is_active=True,
        )
    except LeaveRequest.DoesNotExist as exc:
        raise NotFound("Leave request not found.") from exc


def _user_can_view_parent(request, parent) -> bool:
    role = get_role(request.user)
    if role in {"SystemAdmin", "HRManager", "CEO"}:
        return filter_queryset_by_accessible_companies(LeaveRequest.objects.filter(pk=parent.pk), request).exists()
    if getattr(parent, "employee_id", None) == request.user.id:
        return True
    workflow = sync_workflow(parent, actor=request.user)
    return bool(workflow.current_actor_user_id == request.user.id)


class RequestObligationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        parent_type = request.query_params.get("parent_type", "")
        parent_id = request.query_params.get("parent_id", "")
        if not parent_type or not parent_id:
            return success({"items": [], "summary": {}})
        parent = _resolve_obligation_parent(parent_type, parent_id)
        if not _user_can_view_parent(request, parent):
            raise NotFound("Not found.")

        summary = sync_leave_obligations(parent, actor=request.user)
        parent_ct = ContentType.objects.get_for_model(parent.__class__)
        queryset = RequestObligation.objects.filter(
            parent_content_type=parent_ct,
            parent_object_id=parent.pk,
        ).select_related("waived_by", "resolved_by")
        serializer = RequestObligationSerializer(queryset, many=True)
        return success({"items": serializer.data, "summary": summary})


class RequestObligationWaiveView(APIView):
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]

    def post(self, request, pk):
        reason = (request.data.get("reason") or request.data.get("waiver_reason") or "").strip()
        if not reason:
            return Response(
                {
                    "status": "error",
                    "message": "waiver_reason is required.",
                    "errors": [{"message": "waiver_reason is required."}],
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        try:
            obligation = RequestObligation.objects.select_related("parent_content_type").get(pk=pk)
        except RequestObligation.DoesNotExist as exc:
            raise NotFound("Request obligation not found.") from exc
        parent = obligation.parent
        if parent is None or not _user_can_view_parent(request, parent):
            raise NotFound("Not found.")
        obligation.status = RequestObligation.Status.WAIVED
        obligation.waived_at = timezone.now()
        obligation.waived_by = request.user
        obligation.waiver_reason = reason
        obligation.save(update_fields=["status", "waived_at", "waived_by", "waiver_reason", "updated_at"])
        audit(
            request,
            "request_obligation_waived",
            entity="RequestObligation",
            entity_id=obligation.id,
            metadata={"type": obligation.type, "reason": reason},
        )
        return success(RequestObligationSerializer(obligation).data)


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
