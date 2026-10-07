from datetime import date

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
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
from .notifications import queue_penalty_notification
from .serializers import PenaltyCatalogSerializer, PenaltyRecordSerializer
from .services import _review_recurrence, current_replacement, effective_from, issue, rerate_recurrence, waive
from .warning_notices import notice_filename

Automation = PenaltyRecord.Automation
# Automatic warnings stay out of the HR queue unless HR has something to decide:
# a reopened candidate, a dispute, a correction review or a payroll review.
HR_VISIBLE = (
    Q(automation=Automation.NONE)
    | Q(
        automation=Automation.WARNING_ISSUED,
        status__in=[PenaltyRecord.Status.PENDING_HR_MARK, PenaltyRecord.Status.DISPUTED],
    )
    | Q(resolution__decision="manual_review")
    | Q(deduction__status__in=[PenaltyDeduction.Status.PENDING_REVIEW, PenaltyDeduction.Status.HELD])
)


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
            "company", "employee_profile", "employee_profile__user", "catalog", "deduction", "warning_notice"
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
        include_automated = params.get("include_automated", "").lower() in {"1", "true"}
        hr_scope = get_role(self.request.user) in {"HRManager", "SystemAdmin"} and params.get(
            "mine", ""
        ).lower() not in {"1", "true"}
        if self.action == "list" and hr_scope and not include_automated and profile_id is None:
            # Employees always see their own automatic warnings (they received the letter).
            queryset = queryset.filter(HR_VISIBLE)
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
        if not isinstance(data, dict):
            return error("Request body must be an object.", status=422)
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
            if profile.is_archived or profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
                return error("Only active, non-archived employees are eligible for penalties.", status=422)
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
            queue_penalty_notification(record, "issued")
            queue_penalty_notification(record, "issued", hr=True)
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
            record = self.get_queryset().select_for_update(of=("self",)).get(pk=record.pk)
            if record.source != PenaltyRecord.Source.AUTOMATIC or record.status != PenaltyRecord.Status.PENDING_HR_MARK:
                return error("This candidate has already been marked.", status=409)
            if record.automation:
                # An HR decision takes the candidate out of the automatic warning flow.
                record.automation = Automation.NONE
                record.save(update_fields=["automation", "updated_at"])
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
            event = "issued" if choice != "excused" else "waived"
            queue_penalty_notification(record, event)
            if choice != "excused":
                queue_penalty_notification(record, event, hr=True)
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        with transaction.atomic():
            profile_id = (
                self.get_queryset()
                .filter(pk=pk, employee_profile__user=request.user)
                .values_list("employee_profile_id", flat=True)
                .first()
            )
            if profile_id:
                EmployeeProfile.objects.select_for_update().get(pk=profile_id)
            record = (
                self.get_queryset()
                .select_for_update(of=("self",))
                .filter(pk=pk, employee_profile__user=request.user)
                .first()
            )
            if not record:
                return error("Not found.", status=404)
            if (
                (record.source != PenaltyRecord.Source.HR and record.automation != Automation.WARNING_ISSUED)
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
            queue_penalty_notification(record, "acknowledged", hr=True)
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"])
    def dispute(self, request, pk=None):
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            return error("A reason is required.", {"reason": ["Explain the dispute."]}, 422)
        with transaction.atomic():
            profile_id = (
                self.get_queryset()
                .filter(pk=pk, employee_profile__user=request.user)
                .values_list("employee_profile_id", flat=True)
                .first()
            )
            if profile_id:
                EmployeeProfile.objects.select_for_update().get(pk=profile_id)
            record = (
                self.get_queryset()
                .select_for_update(of=("self",))
                .filter(pk=pk, employee_profile__user=request.user)
                .first()
            )
            if not record:
                return error("Not found.", status=404)
            # Automatic warnings had no HR check, so the employee can dispute them.
            if (
                (record.source != PenaltyRecord.Source.HR and record.automation != Automation.WARNING_ISSUED)
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
            queue_penalty_notification(record, "disputed", hr=True)
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        ensure_company_write_allowed(request)
        _selected_company(request)
        decision = request.data.get("decision")
        note = str(request.data.get("note") or "").strip()
        if decision not in {"uphold", "waive", "reopen", "rerate"} or not note:
            return error(
                "Invalid resolution.", {"decision": ["Use uphold, waive, reopen or rerate and provide a note."]}, 422
            )
        with transaction.atomic():
            profile_id = self.get_queryset().filter(pk=pk).values_list("employee_profile_id", flat=True).first()
            if profile_id:
                EmployeeProfile.objects.select_for_update().get(pk=profile_id)
            record = self.get_queryset().select_for_update(of=("self",)).filter(pk=pk).first()
            if not record:
                return error("Not found.", status=404)
            if (
                record.status != PenaltyRecord.Status.DISPUTED
                and (record.resolution or {}).get("decision") != "manual_review"
            ):
                return error("Only disputed penalties or correction reviews can be resolved.", status=409)
            if decision == "uphold" and (record.resolution or {}).get("decision") == "manual_review":
                return error(
                    "Correction review requires waiver and a new HR assessment; the original rating cannot be upheld.",
                    status=409,
                )
            if decision == "rerate":
                try:
                    rerate_recurrence(record, note=note, request=request)
                except PermissionError as exc:
                    return error(str(exc), status=409)
                except ValueError as exc:
                    transaction.set_rollback(True)
                    return error(str(exc), status=422)
                queue_penalty_notification(record, "resolved")
                queue_penalty_notification(record, "corrected", hr=True)
                return success(self._fresh_data(record.pk))
            if decision == "reopen":
                deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
                if (
                    record.source != PenaltyRecord.Source.AUTOMATIC
                    or (record.resolution or {}).get("decision") != "manual_review"
                    or record.status == PenaltyRecord.Status.APPLIED
                    or (deduction and deduction.status == PenaltyDeduction.Status.APPLIED)
                ):
                    return error("Only unapplied automatic correction reviews can be reopened.", status=409)
                # Never install a stored proposal: it may predate a later correction.
                replacement = current_replacement(record)
                if replacement is None:
                    return error(
                        "Recalculate attendance to establish replacement evidence before reopening.", status=409
                    )
                code, occurred_on, candidate_note, evidence = replacement
                audit(
                    request,
                    "penalty_correction_reopened",
                    "PenaltyRecord",
                    record.pk,
                    {
                        "note": note,
                        "previous_catalog_code": record.catalog.code,
                        "previous_evidence": record.evidence,
                        "previous_resolution": record.resolution,
                        "previous_amount": str(record.total_deduction_amount),
                        "current_evidence": {
                            "catalog_code": code,
                            "occurred_on": str(occurred_on),
                            "evidence": evidence,
                        },
                    },
                )
                record.catalog = PenaltyCatalog.objects.get(code=code)
                record.evidence = evidence
                record.occurred_on = occurred_on
                record.note = candidate_note
                record.status = PenaltyRecord.Status.PENDING_HR_MARK
                record.action = "pending_hr_mark"
                record.occurrence_number = 0
                record.amount = record.extra_wage_amount = record.total_deduction_amount = 0
                record.resolution = {"decision": "reopened", "note": note, "reopened_at": timezone.now().isoformat()}
                record.save()
                queue_penalty_notification(record, "reopened", hr=True)
                if deduction:
                    deduction.status = PenaltyDeduction.Status.VOID
                    deduction.save(update_fields=["status", "updated_at"])
                # The record no longer counts toward recurrence until re-marked.
                _review_recurrence(record)
                return success(self._fresh_data(record.pk))
            if decision == "waive":
                waive(record, reason=note, request=request)
                if record.automation == Automation.WARNING_ISSUED:
                    # waive() already sends the employee the withdrawn notice.
                    return success(self._fresh_data(record.pk))
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
            queue_penalty_notification(record, "resolved")
            if decision != "waive":
                queue_penalty_notification(record, "resolved", hr=True)
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
            profile_id = self.get_queryset().filter(pk=pk).values_list("employee_profile_id", flat=True).first()
            if profile_id:
                EmployeeProfile.objects.select_for_update().get(pk=profile_id)
            record = self.get_queryset().select_for_update(of=("self",)).filter(pk=pk).first()
            if not record:
                return error("Not found.", status=404)
            if record.status != PenaltyRecord.Status.ISSUED or record.total_deduction_amount <= 0:
                return error("Only issued monetary penalties can be reviewed.", status=409)
            if decision == "approve" and (record.resolution or {}).get("decision") == "manual_review":
                return error("Resolve the attendance or recurrence correction before payroll approval.", status=409)
            deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
            if not deduction or deduction.status in {PenaltyDeduction.Status.APPLIED, PenaltyDeduction.Status.VOID}:
                return error("This deduction is locked or unavailable.", status=409)
            previous_status = deduction.status
            deduction.status = (
                PenaltyDeduction.Status.APPROVED if decision == "approve" else PenaltyDeduction.Status.HELD
            )
            deduction.review_note = note
            deduction.reviewed_by = request.user
            deduction.reviewed_at = timezone.now()
            deduction.save(update_fields=["status", "review_note", "reviewed_by", "reviewed_at", "updated_at"])
            audit(request, "penalty_payroll_reviewed", "PenaltyRecord", record.pk, {"decision": decision, "note": note})
            if deduction.status != previous_status:
                queue_penalty_notification(
                    record,
                    "payroll_approved" if decision == "approve" else "payroll_held",
                    hr=True,
                    transition=deduction.updated_at.isoformat(),
                )
        return success(self._fresh_data(record.pk))

    @action(detail=True, methods=["get"], url_path="warning-notice")
    def warning_notice(self, request, pk=None):
        # Scoped like retrieve: own records for employees, the selected company for HR.
        record = self.get_object()
        notice = getattr(record, "warning_notice", None)
        if notice is None or not notice.document:
            return error("Notice not found.", status=status.HTTP_404_NOT_FOUND)
        try:
            handle = notice.document.open("rb")
        except (FileNotFoundError, OSError, ValueError):
            return error("Notice not found.", status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(handle, content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="{notice_filename(notice)}"'
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        audit(
            request, "penalty_warning_notice_downloaded", "PenaltyWarningNotice", notice.pk, {"penalty_id": record.pk}
        )
        return response
