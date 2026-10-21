"""Audited, company-scoped configuration services; endpoint wiring is Phase 2."""

from copy import deepcopy

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied

from audit.models import AuditLog
from audit.utils import audit
from employees.models import EmployeeProfile
from organization.models import OrganizationNode
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)

from .models import PayrollAdjustment, PayrollRun, PayrollSettings
from .permissions import IsPayrollManager
from .settings_serializers import EmployeeGosiUpdateSerializer, SettingsUpdateSerializer


class PayrollDomainError(APIException):
    def __init__(self, code, *, status_code=422, field=None, **params):
        from .i18n import translated

        self.status_code = status_code
        key = "payroll.validation." + code
        issue = {"code": code, "message": translated(key), "message_key": key, "params": params}
        if field:
            issue["field"] = field
        # Keep typed params for the Phase 2 response adapter; DRF converts detail leaves to strings.
        self.payload = {"status": "error", "message": translated(key), "errors": [issue]}
        super().__init__(self.payload, code=code)


def payroll_company(request):
    if not IsPayrollManager().has_permission(request, None):
        raise PermissionDenied()
    ensure_company_write_allowed(request)
    return get_active_company_for_request(request)


def configuration_history(request, action, entity, instance, original, new, reason, revision, *, run=None):
    metadata = {
        "company_id": instance.company_id,
        "original_value": original,
        "new_value": new,
        "reason": reason,
        "input_revision": revision,
    }
    audit(request, action, entity=entity, entity_id=instance.pk, metadata=metadata)
    # Entity writes are serialized by their owning row lock, so this event is the one just written.
    event = AuditLog.objects.filter(action=action, entity=entity, entity_id=str(instance.pk)).latest("id")
    history_type = {"PayrollSettings": "SETTINGS_CHANGE", "EmployeeProfile": "EMPLOYEE_GOSI_CHANGE"}.get(
        entity, "SETTINGS_REFRESH"
    )
    history = PayrollAdjustment(
        company_id=instance.company_id,
        audit_log=event,
        run=run,
        type=history_type,
        changed_fields=sorted(key for key in new if original is None or original.get(key) != new[key]),
        original_value=original,
        new_value=new,
        reason=reason,
        actor=request.user,
        input_revision=revision,
    )
    history.full_clean()
    history.save()
    return history


@transaction.atomic
def update_company_settings(request, payload):
    company = payroll_company(request)
    # Lock the company first: it also serializes initial settings creation.
    OrganizationNode.objects.select_for_update().get(pk=company.pk)
    serializer = SettingsUpdateSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    values = dict(serializer.validated_data)
    expected, reason = values.pop("expected_revision"), values.pop("reason")
    instance = filter_queryset_by_company_scope(PayrollSettings.objects.select_for_update(), request).first()
    actual = instance.revision if instance else 0
    if expected != actual:
        raise PayrollDomainError("stale_revision", status_code=409, expected_revision=expected, current_revision=actual)
    original = instance.snapshot() if instance else None
    instance = instance or PayrollSettings(company=company)
    for key, value in values.items():
        if key.endswith("_base"):
            prefix = key.removesuffix("_base")
            setattr(instance, prefix + "_base_type", value["type"])
            setattr(instance, prefix + "_fixed_amount", value["fixed_amount"])
        else:
            setattr(instance, key, value)
    if original == instance.snapshot():
        return instance
    instance.revision = actual + 1
    instance.full_clean()
    instance.save()
    configuration_history(
        request,
        "payroll_settings_updated",
        "PayrollSettings",
        instance,
        original,
        instance.snapshot(),
        reason,
        instance.revision,
    )
    return instance


@transaction.atomic
def update_employee_gosi(request, profile_id, payload):
    payroll_company(request)
    profile = get_object_or_404(
        filter_queryset_by_company_scope(EmployeeProfile.objects.select_for_update(), request), pk=profile_id
    )
    serializer = EmployeeGosiUpdateSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    if values["expected_revision"] != profile.payroll_config_revision:
        raise PayrollDomainError(
            "stale_revision",
            status_code=409,
            expected_revision=values["expected_revision"],
            current_revision=profile.payroll_config_revision,
        )
    old = {"deduct_gosi_from_employee": profile.deduct_gosi_from_employee}
    if old["deduct_gosi_from_employee"] == values["deduct_gosi_from_employee"]:
        return profile
    profile.deduct_gosi_from_employee = values["deduct_gosi_from_employee"]
    profile.payroll_config_revision += 1
    profile.save(update_fields=["deduct_gosi_from_employee", "payroll_config_revision"])
    configuration_history(
        request,
        "payroll_employee_gosi_updated",
        "EmployeeProfile",
        profile,
        old,
        {"deduct_gosi_from_employee": profile.deduct_gosi_from_employee},
        values["reason"],
        profile.payroll_config_revision,
    )
    return profile


@transaction.atomic
def snapshot_run_settings(request, run_id, *, refresh=False, reason=""):
    payroll_company(request)
    run = get_object_or_404(
        filter_queryset_by_company_scope(PayrollRun.objects.select_for_update(), request), pk=run_id
    )
    if run.status != PayrollRun.Status.DRAFT:
        raise PayrollDomainError("run_not_draft")
    if run.settings_snapshot and not refresh:
        return deepcopy(run.settings_snapshot)
    if not reason.strip():
        raise PayrollDomainError("reason_required", field="reason")
    configured = filter_queryset_by_company_scope(PayrollSettings.objects.select_for_update(), request).first()
    configured = configured or PayrollSettings(company=run.company)
    snapshot = configured.snapshot()
    if not configured.pk:
        snapshot["settings_revision"] = 0
    old = deepcopy(run.settings_snapshot)
    if old != snapshot:
        run.settings_snapshot = deepcopy(snapshot)
        run.revision += 1
        run.save(update_fields=["settings_snapshot", "revision", "updated_at"])
        configuration_history(
            request, "payroll_run_recalculated", "PayrollRun", run, old, snapshot, reason, run.revision, run=run
        )
    return deepcopy(snapshot)
