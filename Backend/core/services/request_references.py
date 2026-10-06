"""Public request references; relational identity remains the request's primary key."""

import re

from django.contrib.contenttypes.models import ContentType
from django.db.models import Max

from core.models import WorkflowInstance
from employees.models import EmployeeProfile

REFERENCE_PREFIXES = {
    "leave_request": "LV",
    "permission_request": "PERM",
    "loan_request": "LN",
    "annual_leave_payment_request": "AED",
    "employee_profile_change": "PC",
    "employee_deletion_request": "EA",
    "asset_return_request": "AR",
    "attendance_correction_request": "AC",
    "contract_decision": "CD",
    "contract_rating": "CR",
    "job_offer": "JO",
    "starting_work_acknowledgment": "SWA",
}
SEQUENTIAL_EMPLOYEE_ID = re.compile(r"^[A-Z][A-Z0-9_]*-[0-9]{4}$")


def has_sequential_employee_id(profile: EmployeeProfile) -> bool:
    return bool(SEQUENTIAL_EMPLOYEE_ID.fullmatch(profile.employee_id or ""))


def request_employee_profile(instance):
    """Resolve the subject employee without using the submitting approver's identity."""

    profile = getattr(instance, "employee_profile", None)
    if profile is not None:
        return profile
    if instance.__class__.__name__ == "AssetReturnRequest":
        return instance.employee
    return None


def next_reference_for_profile(workflow_key: str, profile: EmployeeProfile) -> tuple[str, int]:
    """Reserve the next number under the caller's transaction and employee row lock."""

    prefix = REFERENCE_PREFIXES[workflow_key]
    profile = EmployeeProfile.objects.select_for_update().only("id", "employee_id").get(pk=profile.pk)
    if not has_sequential_employee_id(profile):
        raise ValueError("An employee must have a sequential ID before a new request reference is issued.")
    sequence = (
        WorkflowInstance.objects.filter(definition__key=workflow_key, employee_profile_id=profile.pk).aggregate(
            highest=Max("reference_sequence")
        )["highest"]
        or 0
    ) + 1
    return f"{prefix}-{profile.employee_id}{sequence:02d}", sequence


def assign_new_workflow_reference(workflow: WorkflowInstance, instance) -> None:
    """Assign once, while the caller's submission transaction is open."""

    if workflow.reference_no:
        return
    prefix = REFERENCE_PREFIXES.get(workflow.definition.key)
    profile = request_employee_profile(instance)
    if not prefix or profile is None:
        return
    profile = EmployeeProfile.objects.select_for_update().only("id", "employee_id").get(pk=profile.pk)
    if not has_sequential_employee_id(profile):
        return

    native_reference = getattr(instance, "reference_no", None) or getattr(instance, "reference_number", None)
    native_match = re.fullmatch(rf"{prefix}-{re.escape(profile.employee_id)}([0-9]{{2,}})", native_reference or "")
    if native_match:
        reference_no = native_reference
        sequence = int(native_match.group(1))
    else:
        reference_no, sequence = next_reference_for_profile(workflow.definition.key, profile)

    workflow.employee_profile_id = profile.pk
    workflow.reference_sequence = sequence
    workflow.reference_no = reference_no
    workflow.save(update_fields=["employee_profile", "reference_sequence", "reference_no", "updated_at"])


def public_reference_for(instance) -> str | None:
    """Return the new reference, or an issued legacy reference when one exists."""

    if not getattr(instance, "pk", None):
        return getattr(instance, "reference_no", None) or getattr(instance, "reference_number", None)
    content_type = ContentType.objects.get_for_model(instance.__class__)
    reference = (
        WorkflowInstance.objects.filter(content_type=content_type, object_id=instance.pk)
        .values_list("reference_no", flat=True)
        .first()
    )
    return reference or getattr(instance, "reference_no", None) or getattr(instance, "reference_number", None)
