from django.db.models import Q
from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from core.pagination import StandardPagination
from core.permissions import is_department_ceo_approver_user, is_hr_workflow_approver_user
from core.responses import error, success
from employees.services.manager_relationships import manager_scope_q
from organization.services import ensure_company_write_allowed, filter_queryset_by_company_scope

from . import services
from .criteria import CRITERIA, GRADE_RANGES
from .models import ContractRating
from .pdf import build_contract_rating_pdf
from .permissions import viewer_role
from .serializers import (
    CeoDecisionWriteSerializer,
    ContractRatingReadSerializer,
    HrCommentWriteSerializer,
    HrGateWriteSerializer,
)


class ContractRatingViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ContractRatingReadSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        user = self.request.user
        qs = filter_queryset_by_company_scope(
            ContractRating.objects.select_related(
                "employee_profile",
                "employee_profile__manager_profile__user",
                "contract_decision",
                "manager_response__submitted_by",
                "employee_response__submitted_by",
                "company",
                "manager_at_creation",
                "hr_comment_requested_by",
                "hr_comment_by",
                "ceo_decided_by",
            ),
            self.request,
        )
        scope = (Q(employee_profile__user=user) | manager_scope_q(user, employee_prefix="employee_profile__")) & Q(
            rating_mode=ContractRating.RatingMode.RATE
        )
        if is_hr_workflow_approver_user(user):
            return qs
        if is_department_ceo_approver_user(user):
            scope |= Q(status="PENDING_CEO") | Q(ceo_decided_by=user)
        return qs.filter(scope).distinct()

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

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        rating = self.get_object()
        role = viewer_role(request.user, rating)
        if role == "hr" and not rating.hr_comment_requested_at:
            raise PermissionDenied("HR detail access requires a CEO comment request for this rating.")
        response_row = rating.employee_response if role == "employee" else rating.manager_response
        try:
            pdf_bytes = build_contract_rating_pdf(
                rating,
                response=response_row,
                include_decision=role in {"hr", "ceo"},
            )
        except ValueError as exc:
            return error("PDF unavailable", errors=[str(exc)], status=503)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="contract_rating_{rating.id}.pdf"'
        return response

    @action(detail=False, methods=["get"])
    def criteria(self, request):
        return success({"criteria": CRITERIA, "grade_ranges": GRADE_RANGES})

    def _mutate(self, request, service, serializer_class=None):
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
        return success(self.get_serializer(result).data)

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
        return self._mutate(request, services.submit_ceo_decision, CeoDecisionWriteSerializer)

    @action(detail=True, methods=["post"], url_path="acknowledge-termination-notice")
    def acknowledge_termination_notice(self, request, pk=None):
        ensure_company_write_allowed(request)
        try:
            rating = services.acknowledge_termination_notice(self.get_object().id, actor=request.user)
        except ValueError as exc:
            return error("Validation error", errors=[str(exc)], status=422)
        return success(self.get_serializer(rating).data)
