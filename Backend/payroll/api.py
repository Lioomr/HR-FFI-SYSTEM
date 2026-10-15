"""Approved payroll routes and standard domain error responses."""

import logging
import re
from copy import deepcopy
from datetime import date
from decimal import Decimal

from audit.models import AuditLog
from core.pagination import StandardPagination
from core.responses import error, success
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from employees.models import EmployeeProfile
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_accessible_companies,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import dto, engine
from .accommodation import save_assignment
from .configuration import PayrollDomainError, payroll_company, update_company_settings, update_employee_gosi
from .i18n import ENUMS, enum_directory, translated
from .models import AccommodationAssignment, PayrollAdjustment, PayrollRun, PayrollSettings
from .permissions import PAYROLL_MANAGER_ROLES, IsPayrollManager
from .settings_serializers import MoneyInput, PayrollSettingsSerializer
from .throttles import PayrollExportThrottle, PayrollFinalizeThrottle, PayrollGeneratePayslipsThrottle

logger = logging.getLogger(__name__)


def reason_value(data, *, required=True):
    value = data.get("reason", "")
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > 2000:
        raise PayrollDomainError("reason_required", field="reason")
    return value.strip()


def integer(value, field, minimum=1, maximum=None):
    if isinstance(value, bool):
        raise PayrollDomainError("invalid_choice", field=field)
    try:
        parsed = int(value)
        if str(parsed) != str(value) or parsed < minimum or (maximum is not None and parsed > maximum):
            raise ValueError()
        return parsed
    except (ValueError, TypeError):
        raise PayrollDomainError(
            "invalid_period" if field in ("year", "month") else "invalid_choice", field=field
        ) from None


def boolean(value, field):
    if value in ("true", True):
        return True
    if value in ("false", False):
        return False
    raise PayrollDomainError("invalid_choice", field=field)


def body(data, allowed):
    if not isinstance(data, dict):
        raise PayrollDomainError("invalid_choice")
    extra = set(data) - set(allowed)
    if extra:
        raise PayrollDomainError("field_not_editable", field=sorted(extra)[0])


def iso_date(value, field):
    try:
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError()
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise PayrollDomainError("invalid_date_range", field=field) from None


class PayrollApiMixin:
    permission_classes = [IsAuthenticated, IsPayrollManager]
    pagination_class = StandardPagination

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            ensure_company_write_allowed(request)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def handle_exception(self, exc):
        if isinstance(exc, PayrollDomainError):
            return Response(exc.payload, status=exc.status_code)
        if isinstance(exc, serializers.ValidationError):
            entries = []

            def flatten(value, field=""):
                if isinstance(value, dict):
                    for name, child in value.items():
                        flatten(child, (field + "." + name).strip("."))
                elif isinstance(value, (list, tuple)):
                    for child in value:
                        flatten(child, field)
                else:
                    code = getattr(value, "code", "invalid_choice")
                    known = {row["value"] for row in ENUMS["validation_codes"]}
                    if code not in known:
                        code = "reason_required" if field == "reason" else "invalid_choice"
                    issue = PayrollDomainError(code, field=field or None).payload["errors"][0]
                    entries.append(issue)

            flatten(exc.detail)
            return error(entries[0]["message"] if entries else "Validation error", errors=entries, status=422)
        return super().handle_exception(exc)

    def page(self, values, request, render=lambda v: v):
        for key in ("page", "page_size"):
            if key in request.query_params:
                integer(request.query_params[key], key)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(values, request, view=self)
        if page is not None:
            return paginator.get_paginated_response([render(row) for row in page])
        data = [render(row) for row in values]
        return success({"items": data, "page": 1, "page_size": len(data), "count": len(data), "total_pages": 1})


def history_filters(qs, params, *, adjustments=False):
    start = iso_date(params["date_from"], "date_from") if "date_from" in params else None
    end = iso_date(params["date_to"], "date_to") if "date_to" in params else None
    if start and end and end < start:
        raise PayrollDomainError("invalid_date_range")
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    if "actor_id" in params:
        qs = qs.filter(actor_id=integer(params["actor_id"], "actor_id"))
    if "type" in params and adjustments:
        kinds = [r["value"] for r in ENUMS["adjustment_type"]]
        if params["type"] not in kinds:
            raise PayrollDomainError("invalid_choice", field="type")
        qs = qs.filter(type=params["type"])
    if "action" in params and not adjustments:
        qs = qs.filter(action=params["action"])
    return qs.order_by("-created_at", "-id")


class PayrollSettingsViewSet(PayrollApiMixin, viewsets.GenericViewSet):
    def list(self, request):
        company = payroll_company(request)
        config = PayrollSettings.objects.filter(company=company).first() or PayrollSettings(company=company)
        return success(PayrollSettingsSerializer(config).data)

    @action(detail=False, methods=["get"], url_path="salary-bases")
    def salary_bases(self, request):
        payroll_company(request)
        return success({"items": enum_directory()["salary_base"]})

    @action(detail=False, methods=["get"], url_path="enums")
    def enums(self, request):
        payroll_company(request)
        return success(enum_directory())

    def patch(self, request):
        reason_value(request.data)
        config = update_company_settings(request, request.data)
        return success(PayrollSettingsSerializer(config).data)

    @action(detail=False, methods=["get"], url_path="history")
    def history(self, request):
        company = payroll_company(request)
        qs = PayrollAdjustment.objects.filter(company=company, type="SETTINGS_CHANGE")
        return self.page(history_filters(qs, request.query_params, adjustments=True), request, dto.adjustment_dto)

    @action(detail=False, methods=["get", "patch"], url_path=r"employees/(?P<employee_profile_id>\d+)")
    def employees(self, request, employee_profile_id=None):
        payroll_company(request)
        if request.method == "PATCH":
            reason_value(request.data)
            profile = update_employee_gosi(request, employee_profile_id, request.data)
        else:
            profile = get_object_or_404(
                filter_queryset_by_company_scope(EmployeeProfile.objects.all(), request), pk=employee_profile_id
            )
        return success(
            {
                "employee_profile_id": profile.pk,
                "employee_id": profile.employee_id,
                "deduct_gosi_from_employee": profile.deduct_gosi_from_employee,
                "settings_revision": profile.payroll_config_revision,
            }
        )

    @action(detail=False, methods=["get"], url_path=r"employees/(?P<employee_profile_id>\d+)/history")
    def employee_history(self, request, employee_profile_id=None):
        company = payroll_company(request)
        profile = get_object_or_404(
            filter_queryset_by_company_scope(EmployeeProfile.objects.all(), request), pk=employee_profile_id
        )
        qs = PayrollAdjustment.objects.filter(
            company=company,
            type="EMPLOYEE_GOSI_CHANGE",
            audit_log__entity="EmployeeProfile",
            audit_log__entity_id=str(profile.pk),
        )
        return self.page(history_filters(qs, request.query_params, adjustments=True), request, dto.adjustment_dto)


class PayrollRunViewSet(PayrollApiMixin, viewsets.GenericViewSet):
    def get_queryset(self):
        qs = PayrollRun.objects.select_related("company")
        return (
            filter_queryset_by_company_scope(qs, self.request)
            if self.action == "list"
            else filter_queryset_by_accessible_companies(qs, self.request, roles_with_access=PAYROLL_MANAGER_ROLES)
        )

    def list(self, request):
        qs = self.get_queryset()
        for key, minimum, maximum in (("year", 1900, 2100), ("month", 1, 12)):
            if key in request.query_params:
                qs = qs.filter(**{key: integer(request.query_params[key], key, minimum, maximum)})
        if "status" in request.query_params:
            if request.query_params["status"] not in PayrollRun.Status.values:
                raise PayrollDomainError("invalid_choice", field="status")
            qs = qs.filter(status=request.query_params["status"])
        return self.page(qs.order_by("-year", "-month", "-id"), request, dto.run_dto)

    def create(self, request):
        body(request.data, ("year", "month"))
        ensure_company_write_allowed(request)
        company = get_active_company_for_request(request)
        year, month = (
            integer(request.data.get("year"), "year", 1900, 2100),
            integer(request.data.get("month"), "month", 1, 12),
        )
        try:
            with transaction.atomic():
                run = PayrollRun.objects.create(company=company, year=year, month=month)
                run = engine.recalculate(run, request=request, reason="Payroll draft created")["run"]
                engine.event(
                    request,
                    "payroll_run_created",
                    "PayrollRun",
                    run.pk,
                    None,
                    dto.run_dto(run),
                    "Payroll draft created",
                    company_id=company.pk,
                )
        except IntegrityError:
            if PayrollRun.objects.filter(company=company, year=year, month=month).exclude(status="CANCELLED").exists():
                return error(
                    "Payroll run already exists.", errors=["Payroll run already exists for this period."], status=409
                )
            raise
        return success(dto.run_dto(run), status=201)

    def retrieve(self, request, pk=None):
        return success(dto.run_dto(self.get_object()))

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        run = self.get_object()
        qs = run.items.filter(is_active=True).order_by("pk")
        if "employee_profile_id" in request.query_params:
            qs = qs.filter(
                employee_profile_id=integer(request.query_params["employee_profile_id"], "employee_profile_id")
            )
        if "search" in request.query_params:
            qs = qs.filter(
                Q(employee_id__icontains=request.query_params["search"])
                | Q(employee_name__icontains=request.query_params["search"])
            )
        if "has_warnings" in request.query_params:
            wanted = boolean(request.query_params["has_warnings"], "has_warnings")
            qs = [item for item in qs if bool(dto.item_dto(item)["warnings"]) == wanted]
        return self.page(qs, request, dto.item_dto)

    @action(detail=True, methods=["get", "patch"], url_path=r"items/(?P<item_id>\d+)")
    def item(self, request, pk=None, item_id=None):
        run = self.get_object()
        item = get_object_or_404(run.items.filter(is_active=True), pk=item_id)
        if request.method == "PATCH":
            item = edit_item(run, item, request)
        return success(dto.item_dto(item))

    @action(detail=True, methods=["get"], url_path=r"items/(?P<item_id>\d+)/adjustments")
    def adjustments(self, request, pk=None, item_id=None):
        run = self.get_object()
        item = get_object_or_404(run.items.all(), pk=item_id)
        qs = PayrollAdjustment.objects.filter(company=run.company, run=run, item=item)
        return self.page(history_filters(qs, request.query_params, adjustments=True), request, dto.adjustment_dto)

    @action(detail=True, methods=["get"], url_path="summary")
    def summary(self, request, pk=None):
        return success(dto.summary(self.get_object()))

    @action(detail=True, methods=["get"], url_path="validation-report")
    def validation_report(self, request, pk=None):
        report = dto.validation(self.get_object())
        params = request.query_params
        if "severity" in params and params["severity"] not in ("error", "warning", "info"):
            raise PayrollDomainError("invalid_choice", field="severity")
        if "code" in params and params["code"] not in [r["value"] for r in ENUMS["validation_codes"]]:
            raise PayrollDomainError("invalid_choice", field="code")
        employee = (
            integer(params["employee_profile_id"], "employee_profile_id") if "employee_profile_id" in params else None
        )
        for key, level in (("errors", "error"), ("warnings", "warning"), ("infos", "info")):
            report[key] = [
                i
                for i in report[key]
                if (not employee or (i["employee"] or {}).get("employee_profile_id") == employee)
                and ("code" not in params or i["code"] == params["code"])
                and ("severity" not in params or level == params["severity"])
            ]
        return success(report)

    @action(detail=True, methods=["post"], url_path="recalculate")
    def recalculate(self, request, pk=None):
        body(request.data, ("expected_revision", "reason", "refresh_settings"))
        reason = reason_value(request.data)
        revision = integer(request.data.get("expected_revision"), "expected_revision")
        refresh = request.data.get("refresh_settings", False)
        if not isinstance(refresh, bool):
            raise PayrollDomainError("invalid_choice", field="refresh_settings")
        result = engine.recalculate(
            self.get_object(),
            request=request,
            reason=reason,
            expected_revision=revision,
            refresh_settings=refresh,
            advance_revision=True,
        )
        run = result["run"]
        return success(
            {
                **message("recalculated"),
                "run_id": run.pk,
                "revision": run.revision,
                "status": run.status,
                "settings_revision": run.settings_snapshot["settings_revision"],
                "total_net": dto.amount(run.total_net),
                "total_company_cost": dto.amount(run.total_company_cost),
                "cost_incomplete": run.cost_incomplete,
                "changed_items": result["changed_items"],
                "validation_counts": dto.validation(run)["counts"],
            }
        )

    @action(detail=True, methods=["post"], url_path="finalize", throttle_classes=[PayrollFinalizeThrottle])
    def finalize(self, request, pk=None):
        body(request.data, ("confirm", "expected_revision", "reason"))
        if request.data.get("confirm") is not True:
            return error("Validation error", errors=["confirm must be true."], status=422)
        reason = reason_value(request.data, required="reason" in request.data) or "HR finalized payroll"
        with transaction.atomic():
            run = engine.lock_run(self.get_object())
            if run.status in ("COMPLETED", "PAID"):
                return success(
                    {
                        **message("already_finalized"),
                        "run_id": run.pk,
                        "revision": run.revision,
                        "status": run.status,
                        "validation_counts": dto.validation(run)["counts"],
                    }
                )
            revision = (
                integer(request.data["expected_revision"], "expected_revision")
                if "expected_revision" in request.data
                else None
            )
            result = engine.recalculate(run, request=request, reason=reason, expected_revision=revision)
            run = result["run"]
            report = dto.validation(run)
            if report["errors"]:
                transaction.set_rollback(True)
                return error(report["errors"][0]["message"], errors=report["errors"], status=422)
            engine.apply_claims(run, request)
            engine.apply_carry(run, request, reason)
            original = {"status": run.status, "revision": run.revision}
            run.status, run.finalized_at, run.revision = "COMPLETED", timezone.now(), run.revision + 1
            run.save()
            run.payslips.filter(is_active=True).update(status="COMPLETED")
            for action_name in ("payroll_run_finalized", "payroll_finalized"):
                engine.event(
                    request,
                    action_name,
                    "PayrollRun",
                    run.pk,
                    original,
                    {"status": "COMPLETED", "revision": run.revision},
                    reason,
                    transition_id=f"{run.pk}:{run.revision}",
                    company_id=run.company_id,
                )
        return success(
            {
                **message("finalized"),
                "run_id": run.pk,
                "revision": run.revision,
                "status": run.status,
                "validation_counts": report["counts"],
            }
        )

    @action(
        detail=True, methods=["post"], url_path="generate-payslips", throttle_classes=[PayrollGeneratePayslipsThrottle]
    )
    def generate_payslips(self, request, pk=None):
        body(request.data, ())
        with transaction.atomic():
            run = engine.lock_run(self.get_object())
            if run.status not in ("COMPLETED", "PAID"):
                raise PayrollDomainError("run_not_finalized")
            if not dto.reconciliation(run)["matches"]:
                raise PayrollDomainError("payroll_reconciliation_failed")
            count = run.payslips.filter(is_active=True).exclude(status="PAID").update(status="PAID")
            if run.status != "PAID":
                run.status, run.paid_at = "PAID", timezone.now()
                run.save(update_fields=["status", "paid_at", "updated_at"])
                engine.event(
                    request,
                    "payslips_generated",
                    "PayrollRun",
                    run.pk,
                    {"status": "COMPLETED"},
                    {"status": "PAID"},
                    "Payslips published",
                    company_id=run.company_id,
                )
            if count:
                transaction.on_commit(lambda: notify_payslips(run.pk))
        return success(
            {
                **message("generated"),
                "generated_count": count,
                "total_payslips": run.payslips.filter(is_active=True).count(),
                "run_status": run.status,
                "download_pdf_url": f"/payroll-runs/{run.pk}/export/?file_format=pdf",
            }
        )

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        body(request.data, ("expected_revision", "reason"))
        original = self.get_object()
        run, counts = engine.cancel(
            original,
            request=request,
            reason=reason_value(request.data),
            expected_revision=integer(request.data.get("expected_revision"), "expected_revision"),
        )
        return success(
            {
                **message("already_cancelled" if original.status == "CANCELLED" else "cancelled"),
                "run_id": run.pk,
                "revision": run.revision,
                "status": run.status,
                **counts,
                "cancelled_at": run.cancelled_at.isoformat() if run.cancelled_at else None,
                "cancelled_by": run.cancelled_by_id,
                "cancel_reason": run.cancel_reason,
            }
        )

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        run = self.get_object()
        qs = AuditLog.objects.filter(
            Q(entity="PayrollRun", entity_id=str(run.pk))
            | Q(metadata__run_id=run.pk)
            | Q(metadata__payroll_run_id=run.pk)
        )
        return self.page(history_filters(qs, request.query_params), request, dto.audit_dto)

    @action(detail=True, methods=["get"], url_path="accommodation-report")
    def accommodation_report(self, request, pk=None):
        run = self.get_object()
        qs = run.rent_allocations.select_related("rent", "run").order_by("rent_id")
        if "rent_id" in request.query_params:
            qs = qs.filter(rent_id=integer(request.query_params["rent_id"], "rent_id"))
        return self.page(qs, request, dto.rent_dto)

    @action(detail=True, methods=["get"], url_path="export", throttle_classes=[PayrollExportThrottle])
    def export(self, request, pk=None):
        from .views import _export_payroll_run_response

        return _export_payroll_run_response(request, self.get_object())


class PayrollRunExportView(PayrollApiMixin, APIView):
    throttle_classes = [PayrollExportThrottle]

    def get(self, request, pk):
        from .views import _export_payroll_run_response

        run = get_object_or_404(
            filter_queryset_by_accessible_companies(
                PayrollRun.objects.all(), request, roles_with_access=PAYROLL_MANAGER_ROLES
            ),
            pk=pk,
        )
        return _export_payroll_run_response(request, run)


def message(key):
    return {"message": translated("payroll.message." + key), "message_key": "payroll.message." + key}


def notify_payslips(run_id):
    from in_app_notifications.dispatcher import dispatch_notification_channels
    from in_app_notifications.i18n import notification_text
    from in_app_notifications.models import Notification

    run = PayrollRun.objects.get(pk=run_id)
    for slip in run.payslips.select_related("employee").filter(is_active=True, employee__isnull=False):
        try:
            dispatch_notification_channels(
                recipient=slip.employee,
                company=run.company,
                event_key="payroll.payslip_available",
                **notification_text("payroll.payslip_available", period=f"{run.year}-{run.month:02d}"),
                category=Notification.Category.PAYROLL,
                action_url=f"/employee/payslips/{slip.pk}",
                related_object=slip,
                deduplication_key=f"payroll.payslip:{slip.pk}",
            )
        except Exception:
            logger.exception("payroll_payslip_notification_failed", extra={"entity_id": slip.pk})


@transaction.atomic
def edit_item(run, item, request):
    body(request.data, ("expected_revision", "changes", "reason"))
    reason = reason_value(request.data)
    run = engine.lock_run(run)
    engine.guard(run, integer(request.data.get("expected_revision"), "expected_revision"))
    item = get_object_or_404(run.items.filter(is_active=True), pk=item.pk)
    changes = request.data.get("changes")
    allowed = {
        "absence_days_override",
        "overtime_normal_hours",
        "weekly_rest_work_days",
        "official_holiday_work_days",
        "bonus",
        "incentive",
        "other_addition",
        "other_deduction",
        "salary_components",
        "zero_salary_reason",
        "zero_salary_reason_detail",
        "suspended_pay_decision",
        "override_overtime_eligibility",
    }
    body(changes, allowed)
    if not changes:
        raise PayrollDomainError("field_not_editable", field="changes")
    cleaned = {}
    for key, value in changes.items():
        if key == "salary_components":
            body(value, engine.SALARY_COMPONENTS)
            cleaned[key] = {name: str(MoneyInput().run_validation(v)) for name, v in value.items()}
        elif key == "override_overtime_eligibility":
            if not isinstance(value, bool):
                raise PayrollDomainError("invalid_choice", field=key)
            cleaned[key] = value
        elif key in ("zero_salary_reason", "suspended_pay_decision"):
            choices = [
                r["value"]
                for r in ENUMS["zero_salary_reason" if key == "zero_salary_reason" else "suspended_pay_decision"]
            ]
            if value is not None and value not in choices:
                raise PayrollDomainError("invalid_choice", field=key)
            if key == "suspended_pay_decision" and item.employee_profile.employment_status != "SUSPENDED":
                raise PayrollDomainError("field_not_editable", field=key)
            cleaned[key] = value
        elif key == "zero_salary_reason_detail":
            if value is not None and (not isinstance(value, str) or len(value) > 2000):
                raise PayrollDomainError("invalid_choice", field=key)
            cleaned[key] = value or ""
        elif key == "absence_days_override" and value is None:
            cleaned[key] = None
        else:
            field = MoneyInput()
            if key in (
                "absence_days_override",
                "overtime_normal_hours",
                "weekly_rest_work_days",
                "official_holiday_work_days",
            ):
                field = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=0)
                if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d{1,2})?", value):
                    raise PayrollDomainError("invalid_quantity", field=key)
            cleaned[key] = str(field.run_validation(value))
    original = dto.item_dto(item)
    if "salary_components" in cleaned and original["monthly_salary_components"] is not None:
        cleaned["salary_components"] = {
            name: value
            for name, value in cleaned["salary_components"].items()
            if Decimal(value) != Decimal(original["monthly_salary_components"][name])
        }
        if not cleaned["salary_components"]:
            del cleaned["salary_components"]
    old = deepcopy(item.input_snapshot)
    overrides = item.input_snapshot.setdefault("overrides", {})
    if all(
        (key in overrides and overrides[key] == value)
        if key != "salary_components"
        else all(overrides.get(key, {}).get(name) == v for name, v in value.items())
        for key, value in cleaned.items()
    ):
        raise PayrollDomainError("field_not_editable", field="changes")
    for key, value in cleaned.items():
        if key == "salary_components":
            overrides.setdefault(key, {}).update(value)
        else:
            overrides[key] = value
    if "absence_days_override" in cleaned:
        item.input_snapshot["absence_override_reason"] = reason
    if "override_overtime_eligibility" in cleaned:
        item.input_snapshot["overtime_override_reason"] = reason
    result = engine.recalculate(
        run,
        request=request,
        reason=reason,
        advance_revision=True,
        audit_source_changes=False,
        input_snapshots={item.pk: item.input_snapshot},
    )
    item.refresh_from_db()
    item.payroll_run = result["run"]
    new = dto.item_dto(item)
    kinds = {
        "absence_days_override": "ABSENCE_OVERRIDE",
        "salary_components": "SALARY_ADJUSTMENT",
        "zero_salary_reason": "ZERO_SALARY_REASON",
        "other_deduction": "OTHER_DEDUCTION_ENTRY",
        "override_overtime_eligibility": "OVERTIME_ELIGIBILITY_OVERRIDE",
    }
    for kind in {
        kinds.get(key, "MANUAL_ADJUSTMENT" if key == "suspended_pay_decision" else "ADDITION_ENTRY") for key in cleaned
    }:
        log = engine.event(
            request,
            "payroll_item_adjusted",
            "PayrollRunItem",
            item.pk,
            {"overrides": old.get("overrides", {}), "automatic_source": old.get("source", {}), "effective": original},
            {"overrides": item.input_snapshot["overrides"], "effective": new},
            reason,
            company_id=run.company_id,
            run_id=run.pk,
        )
        PayrollAdjustment.objects.create(
            company_id=run.company_id,
            run=run,
            item=item,
            audit_log=log,
            type=kind,
            changed_fields=sorted(cleaned),
            original_value=engine.frozen({"overrides": old.get("overrides", {}), "effective": original}),
            new_value=engine.frozen({"overrides": item.input_snapshot["overrides"], "effective": new}),
            reason=reason,
            actor=request.user,
            input_revision=result["run"].revision,
        )
    if cleaned.get("override_overtime_eligibility"):
        engine.event(
            request,
            "payroll_overtime_override",
            "PayrollRunItem",
            item.pk,
            original["overtime"],
            new["overtime"],
            reason,
            company_id=run.company_id,
            run_id=run.pk,
        )
    return item


class AccommodationViewSet(PayrollApiMixin, viewsets.GenericViewSet):
    def get_queryset(self):
        payroll_company(self.request)
        return filter_queryset_by_company_scope(
            AccommodationAssignment.objects.select_related("employee_profile", "rent", "created_by", "updated_by"),
            self.request,
        )

    def list(self, request):
        qs = self.get_queryset().filter(is_active=boolean(request.query_params.get("is_active", "true"), "is_active"))
        for key in ("employee_profile_id", "rent_id"):
            if key in request.query_params:
                qs = qs.filter(**{key: integer(request.query_params[key], key)})
        if "status" in request.query_params:
            if request.query_params["status"] not in ("assigned", "none", "unknown"):
                raise PayrollDomainError("invalid_choice", field="status")
            qs = qs.filter(status=request.query_params["status"])
        if "active_on" in request.query_params:
            value = iso_date(request.query_params["active_on"], "active_on")
            qs = qs.filter(start_date__lte=value, end_date__gte=value)
        return self.page(qs.order_by("-start_date", "-id"), request, dto.assignment_dto)

    def retrieve(self, request, pk=None):
        return success(dto.assignment_dto(self.get_object()))

    def create(self, request):
        obj = self.write(request)
        return success(dto.assignment_dto(obj), status=201)

    def partial_update(self, request, pk=None):
        return success(dto.assignment_dto(self.write(request, self.get_object())))

    def write(self, request, obj=None):
        allowed = ("status", "rent_id", "start_date", "end_date", "reason") + (() if obj else ("employee_profile_id",))
        body(request.data, allowed)
        reason = reason_value(request.data)
        data = request.data
        return save_assignment(
            request,
            employee_profile_id=obj.employee_profile_id
            if obj
            else integer(data.get("employee_profile_id"), "employee_profile_id"),
            status=data.get("status", obj.status if obj else None),
            rent_id=integer(data["rent_id"], "rent_id")
            if data.get("rent_id") is not None
            else None
            if "rent_id" in data
            else obj.rent_id
            if obj
            else None,
            start_date=iso_date(data["start_date"], "start_date")
            if "start_date" in data
            else obj.start_date
            if obj
            else iso_date(None, "start_date"),
            end_date=iso_date(data["end_date"], "end_date")
            if "end_date" in data
            else obj.end_date
            if obj
            else iso_date(None, "end_date"),
            reason=reason,
            assignment_id=obj.pk if obj else None,
        )

    @transaction.atomic
    def destroy(self, request, pk=None):
        body(request.data, ("reason",))
        reason = reason_value(request.data)
        obj = self.get_object()
        EmployeeProfile.objects.select_for_update().get(pk=obj.employee_profile_id)
        obj = self.get_queryset().select_for_update(of=("self",)).get(pk=obj.pk)
        if obj.is_active:
            original = dto.assignment_dto(obj)
            obj.is_active, obj.updated_by = False, request.user
            obj.save()
            engine.event(
                request,
                "payroll_accommodation_assignment_deleted",
                "AccommodationAssignment",
                obj.pk,
                original,
                dto.assignment_dto(obj),
                reason,
                company_id=obj.company_id,
            )
        return HttpResponse(status=204)

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        obj = self.get_object()
        logs = AuditLog.objects.filter(entity="AccommodationAssignment", entity_id=str(obj.pk))

        def render(log):
            data = {
                "id": log.pk,
                **dto.audit_dto(log),
                "type": "ASSIGNMENT_CHANGE",
                "changed_fields": [
                    k
                    for k in (log.metadata.get("new_value") or {})
                    if (log.metadata.get("original_value") or {}).get(k) != log.metadata["new_value"][k]
                ],
                "assignment_id": obj.pk,
            }
            data.pop("action")
            return data

        return self.page(history_filters(logs, request.query_params), request, render)
