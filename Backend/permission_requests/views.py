"""Exit permission request API, mounted at ``/api/permission-requests/``.

The workflow is Direct Manager -> HR -> approved. There is no CEO stage and
therefore no CEO route, queue, or action.
"""

from django.db.models import Q
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated

from core.pagination import StandardPagination
from core.responses import error, success
from employees.services.manager_relationships import manager_scope_q
from organization.services import (
    filter_queryset_by_accessible_companies,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)

from . import services
from .models import PermissionRequest
from .pdf_permission_request import build_permission_request_pdf
from .permissions import (
    HasActiveEmployeeProfile,
    IsPermissionRequestHRApprover,
    IsPermissionRequestManager,
    get_active_requester_profile,
    is_hr_approver_user,
)
from .serializers import (
    PermissionRequestCreateSerializer,
    PermissionRequestDecisionSerializer,
    PermissionRequestDetailSerializer,
    PermissionRequestReadSerializer,
)

Status = PermissionRequest.Status
Decision = PermissionRequest.Decision

READ_SELECT_RELATED = (
    "employee",
    "employee_profile",
    "employee_profile__department_ref",
    "employee_profile__position_ref",
    "company",
    "manager_decision_by",
    "manager_decision_by__employee_profile",
    "hr_decision_by",
    "hr_decision_by__employee_profile",
)

MANAGER_ACTIONS = frozenset({"manager_queue", "manager_approve", "manager_reject"})
HR_ACTIONS = frozenset({"hr_queue", "hr_approve", "hr_reject"})


def _not_found():
    return error("Not found", errors=["Not found."], status=status.HTTP_404_NOT_FOUND)


class PermissionRequestViewSet(viewsets.GenericViewSet):
    queryset = PermissionRequest.objects.none()
    serializer_class = PermissionRequestReadSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    # Numeric ids only, so ``manager/`` and ``hr/`` can never be read as a detail lookup.
    lookup_value_regex = r"\d+"

    def get_permissions(self):
        # Every custom action is listed explicitly; see auth_and_permissions.md.
        if self.action == "create":
            return [IsAuthenticated(), HasActiveEmployeeProfile()]
        if self.action in MANAGER_ACTIONS:
            return [IsAuthenticated(), IsPermissionRequestManager()]
        if self.action in HR_ACTIONS:
            return [IsAuthenticated(), IsPermissionRequestHRApprover()]
        # list, retrieve, cancel, pdf: object access is decided by _visible_queryset.
        return [IsAuthenticated()]

    # -- scoping ----------------------------------------------------------------

    def _base_queryset(self):
        return PermissionRequest.objects.select_related(*READ_SELECT_RELATED)

    def _visible_queryset(self):
        """Requests the caller may open: their own, their team's, or all for HR approvers.

        CEO membership grants nothing here; a CEO sees only their own requests.
        """

        user = self.request.user
        queryset = filter_queryset_by_accessible_companies(self._base_queryset(), self.request)
        if is_hr_approver_user(user):
            return queryset
        return queryset.filter(
            Q(employee=user) | Q(manager_decision_by=user) | manager_scope_q(user, employee_prefix="employee_profile__")
        ).distinct()

    def _get_visible(self, pk):
        return self._visible_queryset().filter(pk=pk).first()

    def _apply_filters(self, queryset, *, default_status=None):
        params = self.request.query_params
        errors = {}
        status_param = params.get("status") or default_status
        if status_param and status_param != "all":
            if status_param in Status.values:
                queryset = queryset.filter(status=status_param)
            else:
                errors["status"] = [f"Unsupported status. Use one of: {', '.join(Status.values)}, all."]
        for key, lookup in (("date_from", "request_date__gte"), ("date_to", "request_date__lte")):
            raw = params.get(key)
            if not raw:
                continue
            try:
                parsed = parse_date(raw)
            except ValueError:
                parsed = None
            if parsed is None:
                errors[key] = ["Use the YYYY-MM-DD date format."]
            else:
                queryset = queryset.filter(**{lookup: parsed})
        if errors:
            raise ValidationError(errors)
        return queryset.order_by("-created_at", "-id")

    def _paginated(self, queryset):
        page = self.paginate_queryset(queryset)
        items = page if page is not None else list(queryset)
        data = PermissionRequestReadSerializer(items, many=True, context=self.get_serializer_context()).data
        if page is not None:
            return self.get_paginated_response(data)
        return success({"items": data, "page": 1, "page_size": len(data), "count": len(data), "total_pages": 1})

    def _detail(self, instance):
        return PermissionRequestDetailSerializer(instance, context={"request": self.request}).data

    def _reload(self, instance):
        return self._base_queryset().get(pk=instance.pk)

    # -- employee self-service --------------------------------------------------

    def list(self, request, *args, **kwargs):
        queryset = filter_queryset_by_company_scope(self._base_queryset().filter(employee=request.user), request)
        return self._paginated(self._apply_filters(queryset))

    def create(self, request, *args, **kwargs):
        profile = get_active_requester_profile(request.user)
        active_company = get_active_company_for_request(request)
        if active_company is None or active_company.pk != profile.company_id:
            message = "Select your employee company to submit a permission request."
            return error(message, errors=[message], status=status.HTTP_403_FORBIDDEN)

        serializer = PermissionRequestCreateSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        try:
            instance, manager_user = services.submit_permission_request(
                user=request.user, profile=profile, data=serializer.validated_data
            )
        except services.PermissionRequestError as exc:
            return exc.to_response()

        instance = self._reload(instance)
        services.audit_permission_request(request, "permission_request_submitted", instance)
        services.notify_after_submission(instance, manager_user)
        return success(self._detail(instance), message="Permission request submitted.", status=201)

    def retrieve(self, request, pk=None, *args, **kwargs):
        instance = self._get_visible(pk)
        if instance is None:
            return _not_found()
        return success(self._detail(instance))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        instance = self._get_visible(pk)
        if instance is None:
            return _not_found()
        try:
            transition = services.cancel_permission_request(instance, actor=request.user)
        except services.PermissionRequestError as exc:
            return exc.to_response()
        instance = self._reload(instance)
        services.audit_permission_request(
            request, "permission_request_cancelled", instance, from_status=transition.from_status
        )
        return success(self._detail(instance), message="Permission request cancelled.")

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        instance = self._get_visible(pk)
        if instance is None:
            return _not_found()
        pdf_bytes = build_permission_request_pdf(instance)
        services.audit_permission_request(request, "permission_request_pdf_downloaded", instance)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="permission_request_{instance.reference_no}.pdf"'
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    # -- manager stage ------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="manager")
    def manager_queue(self, request):
        queryset = (
            filter_queryset_by_company_scope(self._base_queryset(), request)
            .filter(manager_scope_q(request.user, employee_prefix="employee_profile__"))
            .distinct()
        )
        return self._paginated(self._apply_filters(queryset, default_status=Status.PENDING_MANAGER))

    @action(detail=True, methods=["post"], url_path="manager-approve")
    def manager_approve(self, request, pk=None):
        return self._decide(request, pk, stage="manager", decision=Decision.APPROVED)

    @action(detail=True, methods=["post"], url_path="manager-reject")
    def manager_reject(self, request, pk=None):
        return self._decide(request, pk, stage="manager", decision=Decision.REJECTED)

    # -- HR stage -------------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="hr")
    def hr_queue(self, request):
        # An HR approver's own requests are decided by someone else; keep them out of the queue.
        queryset = filter_queryset_by_company_scope(self._base_queryset(), request).exclude(employee=request.user)
        return self._paginated(self._apply_filters(queryset, default_status=Status.PENDING_HR))

    @action(detail=True, methods=["post"], url_path="hr-approve")
    def hr_approve(self, request, pk=None):
        return self._decide(request, pk, stage="hr", decision=Decision.APPROVED)

    @action(detail=True, methods=["post"], url_path="hr-reject")
    def hr_reject(self, request, pk=None):
        return self._decide(request, pk, stage="hr", decision=Decision.REJECTED)

    def _decide(self, request, pk, *, stage, decision):
        instance = self._get_visible(pk)
        if instance is None:
            return _not_found()
        serializer = PermissionRequestDecisionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)

        apply_decision = services.apply_manager_decision if stage == "manager" else services.apply_hr_decision
        try:
            transition = apply_decision(
                instance,
                actor=request.user,
                decision=decision,
                note=serializer.validated_data.get("comment", ""),
            )
        except services.PermissionRequestError as exc:
            return exc.to_response()

        instance = self._reload(instance)
        services.audit_permission_request(
            request,
            f"permission_request_{stage}_{decision}",
            instance,
            from_status=transition.from_status,
            extra={"actor_source": transition.actor_source} if transition.actor_source else None,
        )
        if stage == "manager":
            services.notify_after_manager_decision(instance)
        else:
            services.notify_after_hr_decision(instance)
        return success(self._detail(instance), message=f"Permission request {decision}.")
