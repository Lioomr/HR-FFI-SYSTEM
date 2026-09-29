from datetime import date

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from accounts.permissions import get_role
from audit.utils import audit
from core.pagination import StandardPagination
from core.responses import error, success
from employees.models import EmployeeProfile
from employees.permissions import IsHRManagerOrAdmin
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
    get_requested_company_id,
)

from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord
from .notifications import notify_penalty
from .serializers import PenaltyCatalogSerializer, PenaltyRecordSerializer
from .services import effective_from, issue, waive


def _selected_company(request):
    if get_requested_company_id(request) is None:
        raise PermissionDenied("Select an active company for this request.")
    company = get_active_company_for_request(request)
    if company is None:
        raise PermissionDenied("Select an active company for this request.")
    return company


class PenaltyCatalogView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Catalog policy is shared; still require a selected authorized company
        # because this endpoint is entered from a company-scoped experience.
        _selected_company(request)
        return success(PenaltyCatalogSerializer(PenaltyCatalog.objects.all(), many=True).data)


class PenaltyViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    permission_classes = [IsAuthenticated]
    serializer_class = PenaltyRecordSerializer
    pagination_class = StandardPagination

    def _fresh_data(self, pk):
        return self.get_serializer(self.get_queryset().get(pk=pk)).data

    def get_permissions(self):
        if self.action in {"create", "mark_disruption", "resolve", "payroll_review"}:
            return [IsAuthenticated(), IsHRManagerOrAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        _selected_company(self.request)
        qs = PenaltyRecord.objects.select_related(
            "company", "employee_profile", "employee_profile__user", "catalog", "deduction"
        ).order_by("-occurred_on", "-id")
        mine = self.request.query_params.get("mine", "").lower() in {"1", "true"}
        if mine or get_role(self.request.user) not in {"HRManager", "SystemAdmin"}:
            qs = qs.filter(employee_profile__user=self.request.user)
        return filter_queryset_by_company_scope(qs, self.request)

    def filter_queryset(self, queryset):
        params = self.request.query_params
        errors = {}
        for key, allowed in (
            ("status", PenaltyRecord.Status.values),
            ("category", ["work_time", "work_organization", "worker_conduct"]),
        ):
            raw = params.get(key)
            if raw is not None:
                values = [v.strip() for v in raw.split(",") if v.strip()]
                if not values or set(values) - set(allowed):
                    errors[key] = ["Invalid filter value."]
                else:
                    queryset = queryset.filter(**{("catalog__category" if key == "category" else key) + "__in": values})
        profile_id = params.get("employee_profile_id")
        if profile_id is not None:
            if profile_id.isdigit() and int(profile_id) > 0:
                queryset = queryset.filter(employee_profile_id=int(profile_id))
            else:
                errors["employee_profile_id"] = ["Use a positive integer id."]
        dates = {}
        for key in ("date_from", "date_to"):
            if key in params:
                try:
                    dates[key] = date.fromisoformat(params[key])
                except ValueError:
                    errors[key] = ["Use YYYY-MM-DD."]
        if dates.get("date_from") and dates.get("date_to") and dates["date_from"] > dates["date_to"]:
            errors["date_to"] = ["date_to must not precede date_from."]
        if "date_from" in dates:
            queryset = queryset.filter(occurred_on__gte=dates["date_from"])
        if "date_to" in dates:
            queryset = queryset.filter(occurred_on__lte=dates["date_to"])
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(employee_profile__full_name_en__icontains=search)
                | Q(employee_profile__full_name_ar__icontains=search)
                | Q(employee_profile__employee_id__icontains=search)
                | Q(catalog__title_en__icontains=search)
                | Q(catalog__title_ar__icontains=search)
            )
        if errors:
            raise ValidationError(errors)
        return queryset

    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except ValidationError as exc:
            return error("Invalid filters.", exc.detail, 422)

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    def create(self, request, *args, **kwargs):
        ensure_company_write_allowed(request)
        company = _selected_company(request)
        data = request.data
        try:
            profile_id = int(data.get("employee_profile_id"))
            occurred_on = date.fromisoformat(data.get("occurred_on"))
        except (ValueError, TypeError):
            return error(
                "Invalid employee or date.", {"employee_profile_id": ["Use a valid id and YYYY-MM-DD date."]}, 422
            )
        if occurred_on < effective_from() or occurred_on > timezone.localdate():
            return error(
                "Penalty date is outside the prospective period.",
                {"occurred_on": ["Use a date from rollout through today."]},
                422,
            )
        note = str(data.get("note") or "").strip()
        if not note:
            return error("A note is required.", {"note": ["Describe the incident."]}, 422)
        catalog = PenaltyCatalog.objects.filter(code=data.get("catalog_code"), automatic=False).first()
        if not catalog:
            return error("Invalid catalog code.", {"catalog_code": ["Select a non-attendance catalog entry."]}, 422)
        with transaction.atomic():
            profile = EmployeeProfile.objects.select_for_update().filter(pk=profile_id, company=company).first()
            if profile is None:
                return error("Not found.", status=404)
            record = PenaltyRecord.objects.create(
                company=company,
                employee_profile=profile,
                catalog=catalog,
                occurred_on=occurred_on,
                occurrence_number=0,
                action="pending",
                status=PenaltyRecord.Status.ISSUED,
                source=PenaltyRecord.Source.HR,
                note=note,
                created_by=request.user,
            )
            try:
                issue(record, request=request)
            except ValueError as exc:
                transaction.set_rollback(True)
                return error(str(exc), {"catalog_code": [str(exc)]}, 422)
            transaction.on_commit(lambda: notify_penalty(record, "issued"))
        return success(self._fresh_data(record.pk), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="mark-disruption")
    def mark_disruption(self, request, pk=None):
        ensure_company_write_allowed(request)
        _selected_company(request)
        choice = request.data.get("disruption")
        note = str(request.data.get("note") or "").strip()
        if choice not in {"disrupted", "not_disrupted", "confirmed", "excused"} or not note:
            return error("Invalid HR marking.", {"disruption": ["Use a valid decision and provide a note."]}, 422)
        with transaction.atomic():
            record = self.get_queryset().filter(pk=pk).first()
            if not record:
                return error("Not found.", status=404)
            EmployeeProfile.objects.select_for_update().get(pk=record.employee_profile_id)
            record = self.get_queryset().select_for_update().get(pk=record.pk)
            if record.source != PenaltyRecord.Source.AUTOMATIC or record.status != PenaltyRecord.Status.PENDING_HR_MARK:
                return error("This candidate has already been marked.", status=409)
            has_disruption_branches = record.catalog.code in {"W01", "W02", "W03", "W04", "W05", "W06"}
            allowed = {"disrupted", "not_disrupted", "excused"} if has_disruption_branches else {"confirmed", "excused"}
            if choice not in allowed:
                return error(
                    "Invalid HR marking for this catalog row.",
                    {"disruption": ["Select an allowed decision for this row."]},
                    422,
                )
            if choice == "excused":
                waive(record, reason=note, request=request, decision="excused")
            else:
                code = record.catalog.code
                if has_disruption_branches:
                    base = int(code[1:])
                    code = f"W{base + (1 if choice == 'disrupted' and base % 2 else -1 if choice == 'not_disrupted' and base % 2 == 0 else 0):02d}"
                catalog = PenaltyCatalog.objects.get(code=code)
                try:
                    issue(
                        record,
                        catalog=catalog,
                        request=request,
                        marker={
                            "decision": choice,
                            "note": note,
                            "resolved_at": timezone.now().isoformat(),
                        },
                    )
                except ValueError as exc:
                    transaction.set_rollback(True)
                    return error(str(exc), status=422)
            transaction.on_commit(lambda: notify_penalty(record, "issued" if choice != "excused" else "waived"))
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        with transaction.atomic():
            record = self.get_queryset().select_for_update().filter(pk=pk, employee_profile__user=request.user).first()
            if not record:
                return error("Not found.", status=404)
            if (
                record.source != PenaltyRecord.Source.HR
                or record.status not in {PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.APPLIED}
                or record.employee_response
            ):
                return error("This penalty cannot be acknowledged.", status=409)
            record.employee_response = {
                "decision": "acknowledged",
                "reason": None,
                "submitted_at": timezone.now().isoformat(),
            }
            record.save(update_fields=["employee_response", "updated_at"])
            audit(request, "penalty_acknowledged", "PenaltyRecord", record.pk)
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"])
    def dispute(self, request, pk=None):
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            return error("A reason is required.", {"reason": ["Explain the dispute."]}, 422)
        with transaction.atomic():
            record = self.get_queryset().select_for_update().filter(pk=pk, employee_profile__user=request.user).first()
            if not record:
                return error("Not found.", status=404)
            if (
                record.source != PenaltyRecord.Source.HR
                or record.status not in {PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.APPLIED}
                or (record.employee_response or {}).get("decision") == "disputed"
            ):
                return error("This penalty cannot be disputed.", status=409)
            prior_response = (record.employee_response or {}).get("decision")
            record.employee_response = {
                "decision": "disputed",
                "reason": reason,
                "submitted_at": timezone.now().isoformat(),
            }
            record.status = PenaltyRecord.Status.DISPUTED
            record.save(update_fields=["employee_response", "status", "updated_at"])
            deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
            if deduction and deduction.status != PenaltyDeduction.Status.APPLIED:
                deduction.status = PenaltyDeduction.Status.HELD
                deduction.save(update_fields=["status", "updated_at"])
            audit(
                request,
                "penalty_disputed",
                "PenaltyRecord",
                record.pk,
                {
                    "reason": reason,
                    "prior_response": prior_response,
                    "payroll_status": deduction.status if deduction else None,
                },
            )
            transaction.on_commit(lambda: notify_penalty(record, "disputed", hr=True))
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        ensure_company_write_allowed(request)
        _selected_company(request)
        decision = request.data.get("decision")
        note = str(request.data.get("note") or "").strip()
        if decision not in {"uphold", "waive"} or not note:
            return error("Invalid resolution.", {"decision": ["Use uphold or waive and provide a note."]}, 422)
        with transaction.atomic():
            record = self.get_queryset().select_for_update().filter(pk=pk).first()
            if not record:
                return error("Not found.", status=404)
            if record.status != PenaltyRecord.Status.DISPUTED:
                return error("Only disputed penalties can be resolved.", status=409)
            if decision == "waive":
                waive(record, reason=note, request=request)
            else:
                deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
                record.status = (
                    PenaltyRecord.Status.APPLIED
                    if deduction and deduction.status == PenaltyDeduction.Status.APPLIED
                    else PenaltyRecord.Status.ISSUED
                )
                record.resolution = {"decision": "uphold", "note": note, "resolved_at": timezone.now().isoformat()}
                record.save(update_fields=["status", "resolution", "updated_at"])
                if deduction and deduction.status != PenaltyDeduction.Status.APPLIED:
                    deduction.status = PenaltyDeduction.Status.PENDING_REVIEW
                    deduction.save(update_fields=["status", "updated_at"])
                audit(request, "penalty_dispute_upheld", "PenaltyRecord", record.pk, {"note": note})
            transaction.on_commit(lambda: notify_penalty(record, "resolved"))
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"], url_path="payroll-review")
    def payroll_review(self, request, pk=None):
        ensure_company_write_allowed(request)
        _selected_company(request)
        decision = request.data.get("decision")
        note = str(request.data.get("note") or "").strip()
        if decision not in {"approve", "hold"} or not note:
            return error("Invalid payroll review.", {"decision": ["Use approve or hold and provide a note."]}, 422)
        with transaction.atomic():
            record = self.get_queryset().select_for_update().filter(pk=pk).first()
            if not record:
                return error("Not found.", status=404)
            if record.status != PenaltyRecord.Status.ISSUED or record.total_deduction_amount <= 0:
                return error("Only issued monetary penalties can be reviewed.", status=409)
            deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
            if not deduction or deduction.status in {PenaltyDeduction.Status.APPLIED, PenaltyDeduction.Status.VOID}:
                return error("This deduction is locked or unavailable.", status=409)
            deduction.status = (
                PenaltyDeduction.Status.APPROVED if decision == "approve" else PenaltyDeduction.Status.HELD
            )
            deduction.review_note = note
            deduction.reviewed_by = request.user
            deduction.reviewed_at = timezone.now()
            deduction.save(update_fields=["status", "review_note", "reviewed_by", "reviewed_at", "updated_at"])
            audit(request, "penalty_payroll_reviewed", "PenaltyRecord", record.pk, {"decision": decision, "note": note})
        return success(self._fresh_data(record.pk))
