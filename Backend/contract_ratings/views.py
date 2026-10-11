from django.db.models import Q
from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from core.document_integrity.api import DocumentIntegrityActionsMixin, frozen_pdf_response
from core.pagination import StandardPagination
from core.permissions import is_department_ceo_approver_user, is_hr_workflow_approver_user
from core.responses import error, success
from core.services.request_references import public_reference_for
from employees.services.manager_relationships import CONTRACT_RATING_CAPABILITY, manager_scope_q
from organization.services import ensure_company_write_allowed, filter_queryset_by_company_scope

from . import services
from .criteria import CRITERIA, GRADE_RANGES
from .document_integrity import DECISION_ROLES
from .models import ContractRating
from .pdf import build_contract_rating_pdf
from .permissions import viewer_role
from .serializers import (
    CeoDecisionWriteSerializer,
    ContractRatingReadSerializer,
    HrCommentWriteSerializer,
    HrGateWriteSerializer,
)


class ContractRatingViewSet(DocumentIntegrityActionsMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ContractRatingReadSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        user = self.request.user
        base = ContractRating.objects.select_related(
            "employee_profile",
            "employee_profile__manager_profile__user",
            "contract_decision",
            "manager_response__submitted_by",
            "employee_response__submitted_by",
            "company",
            "manager_at_creation",
            "hr_gate_decided_by",
            "hr_comment_requested_by",
            "hr_comment_by",
            "ceo_decided_by",
            "employee_notified_of_termination_by",
        )
        qs = filter_queryset_by_company_scope(base, self.request)
        # A manager rates their reports in any company: same-company reports only
        # inside the manager's own company, another company's report only through
        # the manager's current assignment carrying ``contract_ratings.rate``.
        managed = base.filter(
            manager_scope_q(
                user, employee_prefix="employee_profile__", cross_company_capability=CONTRACT_RATING_CAPABILITY
            ),
            rating_mode=ContractRating.RatingMode.RATE,
        )
        # Whatever else they approve, a person's own rating is visible to them only
        # as the rated employee (rate mode); HR and CEO scopes never include it.
        own = Q(employee_profile__user=user)
        if is_hr_workflow_approver_user(user):
            return (qs.exclude(own & ~Q(rating_mode=ContractRating.RatingMode.RATE)) | managed).distinct()
        scope = Q(employee_profile__user=user, rating_mode=ContractRating.RatingMode.RATE)
        if is_department_ceo_approver_user(user):
            scope |= (Q(status="PENDING_CEO") | Q(ceo_decided_by=user)) & ~own
        return (qs.filter(scope) | managed).distinct()

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        qs = qs.order_by("-created_at", "-id")
        page = self.paginate_queryset(qs)
        data = self.get_serializer(page if page is not None else qs, many=True).data
        return (
            self.get_paginated_response(data) if page is not None else success({"results": data, "count": qs.count()})
        )

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    @action(detail=False, methods=["get"], url_path="pending-actions")
    def pending_actions(self, request):
        """Return only the rating IDs that can block the current user.

        Route guards previously downloaded up to 200 fully serialized ratings
        on every employee/manager entry just to find one outstanding action.
        Keep the same authorization boundary as ``get_queryset`` while making
        that check a pair of indexed ``LIMIT 1`` lookups.
        """

        queryset = self.get_queryset().filter(rating_mode=ContractRating.RatingMode.RATE)
        employee = (
            queryset.filter(
                employee_profile__user=request.user,
                status__in=[
                    ContractRating.Status.PENDING_RESPONSES,
                    ContractRating.Status.WAITING_EMPLOYEE,
                ],
            )
            .order_by("-created_at", "-id")
            .values("id", "status")
            .first()
        )
        manager = (
            queryset.filter(
                manager_scope_q(
                    request.user,
                    employee_prefix="employee_profile__",
                    cross_company_capability=CONTRACT_RATING_CAPABILITY,
                ),
                status__in=[
                    ContractRating.Status.PENDING_RESPONSES,
                    ContractRating.Status.WAITING_MANAGER,
                ],
            )
            .order_by("-created_at", "-id")
            .values("id", "status")
            .first()
        )
        return success({"employee": employee, "manager": manager})

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        rating = self.get_object()
        role = viewer_role(request.user, rating)
        if role is None:
            raise PermissionDenied("You cannot view this rating.")
        if role == "hr" and not rating.hr_comment_requested_at:
            raise PermissionDenied("HR detail access requires a CEO comment request for this rating.")
        response_row = rating.employee_response if role == "employee" else rating.manager_response
        reference = public_reference_for(rating) or f"CR-{rating.id}"
        filename = f"contract_rating_{reference}.pdf"
        try:
            if role in DECISION_ROLES:
                # HR/CEO decision copy: the frozen copy once decided (409 if altered or
                # missing, HR-only ?workpaper=1&tz=), else the live render as before.
                return frozen_pdf_response(
                    rating,
                    request,
                    render_live=lambda: build_contract_rating_pdf(
                        rating, response=rating.manager_response, include_decision=True
                    ),
                    filename=filename,
                    content_type="application/pdf",
                )
            # Employee/manager copies are confidential per-audience renders: always live,
            # never frozen and not the verifiable original.
            pdf_bytes = build_contract_rating_pdf(rating, response=response_row, include_decision=False)
        except ValueError as exc:
            return error("PDF unavailable", errors=[str(exc)], status=503)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    def get_integrity_object(self):
        """The decision copy's record for ``integrity/`` endpoints, or ``None`` (404).

        Same lookup as the download (company-scoped ``get_queryset``) and the same
        rule (``viewer_role`` hr after a CEO comment request, or ceo); the employee
        and manager copies are never frozen, so they have nothing to report.
        """

        from .document_integrity import can_access_contract_rating_document

        pk = str(self.kwargs.get(self.lookup_url_kwarg or self.lookup_field) or "")
        if not pk.isdigit():
            return None
        rating = self.get_queryset().filter(pk=int(pk)).first()
        if rating is None or not can_access_contract_rating_document(self.request.user, rating):
            return None
        return rating

    @action(detail=False, methods=["get"])
    def criteria(self, request):
        return success({"criteria": CRITERIA, "grade_ranges": GRADE_RANGES})

    def _mutate(self, request, service, serializer_class=None, *, response_viewer_role=None):
        ensure_company_write_allowed(request)
        rating = self.get_object()
        data = request.data
        if not isinstance(data, dict):
            return error("Validation error", errors=["Expected an object."], status=422)
        if serializer_class:
            serializer = serializer_class(data=data)
            if not serializer.is_valid():
                return error("Validation error", errors=serializer.errors, status=422)
            data = serializer.validated_data
        try:
            result = service(rating.id, actor=request.user, **data)
        except ValueError as exc:
            return error("Validation error", errors=[str(exc)], status=422)
        context = self.get_serializer_context()
        if response_viewer_role:
            context["viewer_role_override"] = response_viewer_role
        return success(self.get_serializer(result, context=context).data)

    @action(detail=True, methods=["post"], url_path="manager-response")
    def manager_response(self, request, pk=None):
        return self._mutate(request, services.submit_manager_response)

    @action(detail=True, methods=["post"], url_path="employee-response")
    def employee_response(self, request, pk=None):
        return self._mutate(request, services.submit_employee_response)

    @action(detail=True, methods=["post"], url_path="hr-gate")
    def hr_gate(self, request, pk=None):
        return self._mutate(request, services.submit_hr_gate_decision, HrGateWriteSerializer)

    @action(detail=True, methods=["post"], url_path="request-hr-comment")
    def request_hr_comment(self, request, pk=None):
        ensure_company_write_allowed(request)
        try:
            rating = services.request_hr_comment(self.get_object().id, actor=request.user)
        except ValueError as exc:
            return error("Validation error", errors=[str(exc)], status=422)
        return success(self.get_serializer(rating).data)

    @action(detail=True, methods=["post"], url_path="hr-comment")
    def hr_comment(self, request, pk=None):
        return self._mutate(request, services.submit_hr_comment, HrCommentWriteSerializer)

    @action(detail=True, methods=["post"], url_path="ceo-decision")
    def ceo_decision(self, request, pk=None):
        return self._mutate(
            request,
            services.submit_ceo_decision,
            CeoDecisionWriteSerializer,
            response_viewer_role="ceo",
        )

    @action(detail=True, methods=["post"], url_path="acknowledge-termination-notice")
    def acknowledge_termination_notice(self, request, pk=None):
        ensure_company_write_allowed(request)
        try:
            rating = services.acknowledge_termination_notice(self.get_object().id, actor=request.user)
        except ValueError as exc:
            return error("Validation error", errors=[str(exc)], status=422)
        return success(self.get_serializer(rating).data)
