from __future__ import annotations

from collections.abc import Iterable

from django.core.exceptions import ValidationError
from django.db.models import Q, QuerySet

from audit.utils import audit
from employees.models import EmployeeProfile

MANAGER_SCOPES = ["leave", "loan", "attendance", "asset", "announcement"]


def _profile_label(profile: EmployeeProfile | None) -> str | None:
    if profile is None:
        return None
    return profile.full_name_en or profile.full_name or profile.employee_id


def _is_active_manager_profile(profile: EmployeeProfile | None) -> bool:
    return bool(
        profile
        and not profile.is_archived
        and profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
        and profile.user_id
        and profile.user
        and profile.user.is_active
    )


def _assignment_cycle_error(employee: EmployeeProfile, manager_profile: EmployeeProfile) -> str | None:
    employee_id = employee.pk
    current = manager_profile
    visited: set[int] = set()

    while current is not None:
        if employee_id is not None and current.pk == employee_id:
            return "Manager assignment cannot create a reporting cycle."
        if current.pk in visited:
            return "The selected manager already belongs to a reporting cycle."
        visited.add(current.pk)
        if not current.manager_profile_id:
            return None
        current = (
            EmployeeProfile.objects.select_related("user")
            .only(
                "id",
                "manager_profile_id",
                "company_id",
                "employment_status",
                "is_archived",
                "user_id",
                "user__is_active",
            )
            .filter(pk=current.manager_profile_id)
            .first()
        )
    return None


def validate_manager_assignment(
    employee: EmployeeProfile,
    manager_profile: EmployeeProfile | None,
    *,
    company=None,
) -> None:
    if manager_profile is None:
        return

    if employee.pk is not None and employee.pk == manager_profile.pk:
        raise ValidationError("An employee cannot be their own manager.")
    if employee.user_id and employee.user_id == manager_profile.user_id:
        raise ValidationError("An employee cannot be their own manager.")
    if manager_profile.is_archived:
        raise ValidationError("The selected manager is archived.")
    if manager_profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
        raise ValidationError("The selected manager must be an active employee.")
    if not manager_profile.user_id:
        raise ValidationError("The selected manager must be linked to a user account.")
    if not manager_profile.user.is_active:
        raise ValidationError("The selected manager must be linked to an active user account.")

    employee_company_id = getattr(company, "pk", None) if company is not None else employee.company_id
    if employee_company_id != manager_profile.company_id:
        raise ValidationError("The selected manager must belong to the employee's company.")

    cycle_error = _assignment_cycle_error(employee, manager_profile)
    if cycle_error:
        raise ValidationError(cycle_error)


def get_valid_direct_manager_profile(employee: EmployeeProfile | None) -> EmployeeProfile | None:
    if employee is None or not employee.manager_profile_id:
        return None
    manager_profile = employee.manager_profile
    try:
        validate_manager_assignment(employee, manager_profile)
    except ValidationError:
        return None
    return manager_profile


def get_valid_direct_manager_user(employee: EmployeeProfile | None):
    manager_profile = get_valid_direct_manager_profile(employee)
    return manager_profile.user if manager_profile else None


def active_direct_reports_queryset(user) -> QuerySet[EmployeeProfile]:
    if not user or not getattr(user, "is_authenticated", False):
        return EmployeeProfile.objects.none()

    manager_profile = getattr(user, "employee_profile", None)
    if not _is_active_manager_profile(manager_profile):
        return EmployeeProfile.objects.none()

    return (
        EmployeeProfile.objects.filter(
            manager_profile_id=manager_profile.id,
            company_id=manager_profile.company_id,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            is_archived=False,
        )
        .filter(Q(user__isnull=True) | Q(user__is_active=True))
        .exclude(pk=manager_profile.pk)
    )


def manager_scope_q(user, *, employee_prefix: str = "") -> Q:
    """Return the authoritative direct/delegated manager scope for an EmployeeProfile join."""

    empty = Q(**{f"{employee_prefix}pk__in": []})
    if not user or not getattr(user, "is_authenticated", False):
        return empty

    actor_profile = getattr(user, "employee_profile", None)
    if not _is_active_manager_profile(actor_profile):
        return empty

    direct_match = Q(
        **{
            f"{employee_prefix}manager_profile_id": actor_profile.id,
            f"{employee_prefix}company_id": actor_profile.company_id,
        }
    )

    from core.delegation import get_delegated_manager_user_ids

    delegated_manager_ids = get_delegated_manager_user_ids(user)
    delegated_match = empty
    if delegated_manager_ids:
        delegated_match = Q(
            **{
                f"{employee_prefix}manager_profile__user_id__in": delegated_manager_ids,
                f"{employee_prefix}manager_profile__company_id": actor_profile.company_id,
                f"{employee_prefix}manager_profile__employment_status": EmployeeProfile.EmploymentStatus.ACTIVE,
                f"{employee_prefix}manager_profile__is_archived": False,
                f"{employee_prefix}manager_profile__user__is_active": True,
                f"{employee_prefix}company_id": actor_profile.company_id,
            }
        )

    not_self = ~Q(**{f"{employee_prefix}user_id": user.id})
    return (direct_match | delegated_match) & not_self


def managed_reports_queryset(user) -> QuerySet[EmployeeProfile]:
    return (
        EmployeeProfile.objects.filter(manager_scope_q(user))
        .filter(
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            is_archived=False,
        )
        .filter(Q(user__isnull=True) | Q(user__is_active=True))
        .distinct()
    )


def has_manager_access(user) -> bool:
    return managed_reports_queryset(user).exists()


def manager_approval_actor_source(user, employee: EmployeeProfile | None, *, allow_admin: bool = False) -> str | None:
    if not user or not getattr(user, "is_authenticated", False) or employee is None:
        return None
    if employee.user_id == user.id:
        return None

    manager_profile = get_valid_direct_manager_profile(employee)
    if manager_profile and manager_profile.user_id == user.id:
        return "direct_manager"

    if manager_profile:
        actor_profile = getattr(user, "employee_profile", None)
        if (
            _is_active_manager_profile(actor_profile)
            and actor_profile.company_id == employee.company_id
            and actor_profile.company_id == manager_profile.company_id
        ):
            from core.delegation import is_user_delegate_for_manager

            if is_user_delegate_for_manager(user, manager_profile.user):
                return "delegate"

    if allow_admin:
        from core.permissions import get_role

        if get_role(user) == "SystemAdmin":
            return "admin"
    return None


def log_manager_assignment_change(
    *,
    employee: EmployeeProfile,
    previous_manager: EmployeeProfile | None,
    new_manager: EmployeeProfile | None,
    changed_by=None,
    request=None,
    source: str,
) -> None:
    if getattr(previous_manager, "pk", None) == getattr(new_manager, "pk", None):
        return

    audit(
        request,
        "employee_manager_changed",
        entity="EmployeeProfile",
        entity_id=employee.pk,
        actor=changed_by,
        metadata={
            "employee_id": employee.pk,
            "previous_manager": {
                "employee_profile_id": getattr(previous_manager, "pk", None),
                "user_id": getattr(previous_manager, "user_id", None),
                "name": _profile_label(previous_manager),
            },
            "new_manager": {
                "employee_profile_id": getattr(new_manager, "pk", None),
                "user_id": getattr(new_manager, "user_id", None),
                "name": _profile_label(new_manager),
            },
            "changed_by": getattr(changed_by, "pk", None),
            "source": source,
        },
    )


def fallback_invalid_manager_stage(instance, *, actor=None) -> bool:
    mapping = {
        "LeaveRequest": ("pending_manager", "pending_hr", "employee_profile"),
        "LoanRequest": ("pending_manager", "pending_hr", "employee_profile"),
        "AttendanceRecord": ("PENDING_MGR", "PENDING_HR", "employee_profile"),
        "AttendanceCorrectionRequest": ("PENDING_MANAGER", "PENDING_HR", "employee_profile"),
        "AssetReturnRequest": ("PENDING_MANAGER", "PENDING", "employee"),
    }
    config = mapping.get(instance.__class__.__name__)
    if not config:
        return False

    manager_status, fallback_status, profile_attr = config
    if instance.status != manager_status:
        return False

    profile = getattr(instance, profile_attr, None)
    if profile is None and instance.__class__.__name__ == "LeaveRequest":
        profile = getattr(getattr(instance, "employee", None), "employee_profile", None)
    if get_valid_direct_manager_user(profile):
        return False

    previous_status = instance.status
    instance.status = fallback_status
    update_fields = ["status"]
    if hasattr(instance, "updated_at"):
        update_fields.append("updated_at")
    instance.save(update_fields=update_fields)
    audit(
        None,
        "manager_stage_fallback_to_hr",
        entity=instance.__class__.__name__,
        entity_id=instance.pk,
        actor=actor,
        metadata={
            "employee_profile_id": getattr(profile, "pk", None),
            "previous_status": previous_status,
            "new_status": fallback_status,
            "reason": "no_valid_manager",
        },
    )
    return True


def reroute_pending_manager_requests(profiles: EmployeeProfile | Iterable[EmployeeProfile], *, actor=None) -> int:
    if isinstance(profiles, EmployeeProfile):
        profiles = [profiles]

    profile_list = list(profiles)
    profile_ids = [profile.pk for profile in profile_list if profile.pk and not get_valid_direct_manager_user(profile)]
    if not profile_ids:
        return 0

    from assets.models import AssetReturnRequest
    from attendance.models import AttendanceCorrectionRequest, AttendanceRecord
    from leaves.models import LeaveRequest
    from loans.models import LoanRequest

    requests = [
        *LeaveRequest.objects.filter(
            Q(employee_profile_id__in=profile_ids) | Q(employee__employee_profile__id__in=profile_ids),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        ),
        *LoanRequest.objects.filter(
            employee_profile_id__in=profile_ids,
            status=LoanRequest.RequestStatus.PENDING_MANAGER,
        ),
        *AttendanceRecord.objects.filter(
            employee_profile_id__in=profile_ids,
            status=AttendanceRecord.Status.PENDING_MANAGER,
        ),
        *AttendanceCorrectionRequest.objects.filter(
            employee_profile_id__in=profile_ids,
            status=AttendanceCorrectionRequest.Status.PENDING_MANAGER,
        ),
        *AssetReturnRequest.objects.filter(
            employee_id__in=profile_ids,
            status=AssetReturnRequest.RequestStatus.PENDING_MANAGER,
        ),
    ]

    rerouted = 0
    for instance in requests:
        rerouted += int(fallback_invalid_manager_stage(instance, actor=actor))
    return rerouted


def find_reporting_cycles(profiles: Iterable[EmployeeProfile] | None = None) -> list[list[int]]:
    if profiles is None:
        profiles = EmployeeProfile.objects.only("id", "manager_profile_id")
    manager_by_id = {profile.id: profile.manager_profile_id for profile in profiles}
    cycles: set[tuple[int, ...]] = set()

    for start_id in manager_by_id:
        path: list[int] = []
        position: dict[int, int] = {}
        current_id = start_id
        while current_id in manager_by_id and current_id is not None:
            if current_id in position:
                cycle = path[position[current_id] :]
                if cycle:
                    rotations = [tuple(cycle[index:] + cycle[:index]) for index in range(len(cycle))]
                    cycles.add(min(rotations))
                break
            position[current_id] = len(path)
            path.append(current_id)
            current_id = manager_by_id.get(current_id)

    return [list(cycle) for cycle in sorted(cycles)]
