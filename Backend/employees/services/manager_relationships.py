from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Prefetch, Q, QuerySet
from django.utils import timezone

from audit.utils import audit
from employees.models import EmployeeProfile

MANAGER_SCOPES = ["leave", "loan", "attendance", "asset", "announcement"]

PERMISSION_REQUEST_APPROVAL_CAPABILITY = "permission_requests.approve"
CONTRACT_RATING_CAPABILITY = "contract_ratings.rate"

# The cross-company capability that lets an employee's cross-company manager act
# on the manager stage of each request type. Request types missing here only
# route to a same-company direct manager.
MANAGER_CAPABILITY_BY_REQUEST_MODEL = {
    "LeaveRequest": "leaves.approve",
    "LoanRequest": "loans.approve",
    "AttendanceRecord": "attendance.approve",
    "AttendanceCorrectionRequest": "attendance.approve",
    "AssetReturnRequest": "assets.approve",
    "PermissionRequest": PERMISSION_REQUEST_APPROVAL_CAPABILITY,
}


def manager_capability_for(instance) -> str | None:
    return MANAGER_CAPABILITY_BY_REQUEST_MODEL.get(instance.__class__.__name__)


def _assignment_model():
    from core.models import CrossCompanyManagerAssignment

    return CrossCompanyManagerAssignment


def full_manager_capabilities() -> list[str]:
    """A cross-company manager has every manager right a direct manager has."""
    return list(_assignment_model().Capability.values)


def current_cross_company_assignments():
    """Assignments in force now. They never expire: only revocation ends them."""
    return _assignment_model().objects.filter(
        is_active=True,
        revoked_at__isnull=True,
        start_at__lte=timezone.now(),
        scope__is_active=True,
    )


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


def _reporting_cycle_error(employee: EmployeeProfile, manager_profile: EmployeeProfile) -> str | None:
    """Walk up from the new manager over direct and cross-company manager links.

    The employee's own current links are ignored: they are what is being replaced.
    """
    direct_error = _assignment_cycle_error(employee, manager_profile)
    if direct_error or employee.pk is None:
        return direct_error

    cross_edges: dict[int, set[int]] = {}
    for report_id, manager_id in (
        current_cross_company_assignments()
        .exclude(employee_id=employee.pk)
        .values_list("employee_id", "manager_profile_id")
    ):
        cross_edges.setdefault(report_id, set()).add(manager_id)
    if not cross_edges:
        return None

    stack = [manager_profile.pk]
    visited: set[int] = set()
    while stack:
        current_id = stack.pop()
        if current_id == employee.pk:
            return "Manager assignment cannot create a reporting cycle."
        if current_id in visited:
            continue
        visited.add(current_id)
        direct_manager_id = (
            EmployeeProfile.objects.filter(pk=current_id).values_list("manager_profile_id", flat=True).first()
        )
        if direct_manager_id:
            stack.append(direct_manager_id)
        stack.extend(cross_edges.get(current_id, ()))
    return None


def _validate_usable_manager(employee: EmployeeProfile, manager_profile: EmployeeProfile) -> None:
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


def validate_manager_assignment(
    employee: EmployeeProfile,
    manager_profile: EmployeeProfile | None,
    *,
    company=None,
) -> None:
    """Validate a same-company (direct) manager link."""
    if manager_profile is None:
        return

    _validate_usable_manager(employee, manager_profile)

    employee_company_id = getattr(company, "pk", None) if company is not None else employee.company_id
    if employee_company_id != manager_profile.company_id:
        raise ValidationError("The selected manager must belong to the employee's company.")

    cycle_error = _reporting_cycle_error(employee, manager_profile)
    if cycle_error:
        raise ValidationError(cycle_error)


def validate_cross_company_manager_assignment(
    employee: EmployeeProfile | None,
    manager_profile: EmployeeProfile | None,
    *,
    scope=None,
    company=None,
) -> None:
    """Validate a manager from another company. ``scope`` is checked only when given."""
    if employee is None or manager_profile is None:
        raise ValidationError("Employee and manager are required.")
    _validate_usable_manager(employee, manager_profile)
    if employee.is_archived:
        raise ValidationError("An archived employee cannot be assigned a manager.")
    employee_company_id = getattr(company, "pk", None) if company is not None else employee.company_id
    if employee_company_id is None or employee_company_id == manager_profile.company_id:
        raise ValidationError("Use manager_profile for normal same-company manager relationships.")
    if scope is not None:
        member_ids = set(scope.memberships.values_list("company_id", flat=True))
        if not scope.is_active or employee_company_id not in member_ids or manager_profile.company_id not in member_ids:
            raise ValidationError({"scope_id": "Both companies must be included in the approved organization scope."})

    cycle_error = _reporting_cycle_error(employee, manager_profile)
    if cycle_error:
        raise ValidationError(cycle_error)


def validate_any_manager_assignment(
    employee: EmployeeProfile, manager_profile: EmployeeProfile | None, *, company=None
):
    """Validate a manager from the employee's own company or from another company."""
    if manager_profile is None:
        return
    employee_company_id = getattr(company, "pk", None) if company is not None else employee.company_id
    if manager_profile.company_id == employee_company_id:
        validate_manager_assignment(employee, manager_profile, company=company)
    else:
        validate_cross_company_manager_assignment(employee, manager_profile, company=company)


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


CURRENT_CROSS_COMPANY_ATTR = "current_cross_company_manager_assignments"


def with_current_cross_company_manager(queryset: QuerySet[EmployeeProfile]) -> QuerySet[EmployeeProfile]:
    """Prefetch each profile's current cross-company manager for display serializers."""
    return queryset.prefetch_related(
        Prefetch(
            "cross_company_manager_assignments",
            queryset=current_cross_company_assignments().select_related("manager_profile__user").order_by("-id"),
            to_attr=CURRENT_CROSS_COMPANY_ATTR,
        )
    )


def get_cross_company_manager_assignment(employee: EmployeeProfile | None):
    if employee is None or employee.pk is None:
        return None
    prefetched = getattr(employee, CURRENT_CROSS_COMPANY_ATTR, None)
    if prefetched is not None:
        return prefetched[0] if prefetched else None
    assignment = (
        current_cross_company_assignments()
        .filter(employee_id=employee.pk)
        .select_related("manager_profile__user")
        .order_by("-id")
        .first()
    )
    # Memoize like a prefetch so one serializer pass costs one query.
    setattr(employee, CURRENT_CROSS_COMPANY_ATTR, [assignment] if assignment else [])
    return assignment


def get_effective_manager_profile(employee: EmployeeProfile | None) -> EmployeeProfile | None:
    """The employee's one manager for display: a cross-company manager wins over a direct one."""
    assignment = get_cross_company_manager_assignment(employee)
    if assignment is not None:
        return assignment.manager_profile
    if employee is not None and employee.manager_profile_id:
        return employee.manager_profile
    return None


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


# Like a direct report, a managed employee does not need an active login.
_MANAGED_EMPLOYEE_LOGIN_Q = Q(employee__user__isnull=True) | Q(employee__user__is_active=True)


def active_cross_company_manager_assignments(user, *, capability: str | None = None):
    """Current, usable cross-company assignments where the authenticated user is the manager.

    Every caller that crosses a company boundary must name the workflow capability;
    an assignment is never an implicit grant for all manager workflows.
    """
    model = _assignment_model()
    if not user or not getattr(user, "is_authenticated", False):
        return model.objects.none()
    actor_profile = getattr(user, "employee_profile", None)
    if not _is_active_manager_profile(actor_profile):
        return model.objects.none()

    queryset = (
        current_cross_company_assignments()
        .filter(
            manager_profile_id=actor_profile.id,
            manager_profile__is_archived=False,
            manager_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            manager_profile__user__is_active=True,
            employee__is_archived=False,
            employee__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        .filter(_MANAGED_EMPLOYEE_LOGIN_Q)
    )
    if capability:
        queryset = queryset.filter(capabilities__contains=[capability])
    return queryset


def manager_scope_q(user, *, employee_prefix: str = "", cross_company_capability: str | None = None) -> Q:
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

    # No capability means direct/delegated same-company scope only.  This
    # prevents a convenience caller from accidentally turning any exceptional
    # assignment into a cross-company authorization path.
    cross_assignment_ids = []
    if cross_company_capability:
        cross_assignment_ids = active_cross_company_manager_assignments(
            user, capability=cross_company_capability
        ).values_list("employee_id", flat=True)
    cross_company_match = Q(**{f"{employee_prefix}pk__in": cross_assignment_ids})

    not_self = ~Q(**{f"{employee_prefix}user_id": user.id})
    return (direct_match | delegated_match | cross_company_match) & not_self


def managed_reports_queryset(user, *, cross_company_capability: str | None = None) -> QuerySet[EmployeeProfile]:
    return (
        EmployeeProfile.objects.filter(manager_scope_q(user, cross_company_capability=cross_company_capability))
        .filter(
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            is_archived=False,
        )
        .filter(Q(user__isnull=True) | Q(user__is_active=True))
        .distinct()
    )


def has_manager_access(user, *, cross_company_capability: str | None = None) -> bool:
    return managed_reports_queryset(user, cross_company_capability=cross_company_capability).exists()


def active_cross_company_manager_assignments_for_employee(employee, *, capability: str | None = None):
    """Current, usable cross-company assignments for the employee (at most one exists)."""
    queryset = (
        current_cross_company_assignments()
        .filter(
            employee=employee,
            employee__is_archived=False,
            employee__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            manager_profile__is_archived=False,
            manager_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            manager_profile__user__is_active=True,
        )
        .filter(_MANAGED_EMPLOYEE_LOGIN_Q)
    )
    if capability:
        queryset = queryset.filter(capabilities__contains=[capability])
    return queryset


def _cross_company_manager_assignment_for(employee, capability: str | None):
    if employee is None or employee.pk is None or not capability:
        return None
    return (
        active_cross_company_manager_assignments_for_employee(employee, capability=capability)
        .select_related("manager_profile__user")
        .order_by("-id")
        .first()
    )


def manager_approval_actor_source(
    user,
    employee: EmployeeProfile | None,
    *,
    capability: str | None = None,
    allow_admin: bool = False,
) -> str | None:
    if not user or not getattr(user, "is_authenticated", False) or employee is None:
        return None
    if employee.user_id == user.id:
        return None

    # The cross-company manager wins over a leftover direct link for every
    # workflow the assignment covers.
    cross_assignment = _cross_company_manager_assignment_for(employee, capability)
    if cross_assignment is not None:
        if cross_assignment.manager_profile.user_id == user.id:
            return "cross_company_assignment"
    else:
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


def get_valid_manager_profile(
    employee: EmployeeProfile | None, *, cross_company_capability: str | None = None
) -> EmployeeProfile | None:
    """The manager profile that acts for ``cross_company_capability``.

    The cross-company manager wins when the assignment covers the capability;
    otherwise the valid same-company direct manager.
    """
    cross_assignment = _cross_company_manager_assignment_for(employee, cross_company_capability)
    if cross_assignment is not None:
        return cross_assignment.manager_profile
    return get_valid_direct_manager_profile(employee)


def get_valid_manager_user(employee: EmployeeProfile | None, *, cross_company_capability: str | None = None):
    """Resolve the manager user who acts for ``cross_company_capability`` (see ``get_valid_manager_profile``)."""
    manager_profile = get_valid_manager_profile(employee, cross_company_capability=cross_company_capability)
    return manager_profile.user if manager_profile else None


@dataclass
class ManagerChange:
    manager_profile: EmployeeProfile | None
    assignment: object | None = None
    assignment_created: bool = False
    changed: bool = False
    revoked_assignment_ids: list[int] = field(default_factory=list)
    created_scope_id: int | None = None
    reassigned_contract_rating_ids: list[int] = field(default_factory=list)


def _actor_user(actor, request):
    user = actor or getattr(request, "user", None)
    return user if getattr(user, "is_authenticated", False) else None


def get_or_create_manager_scope(company_a, company_b, *, actor=None, request=None):
    """Return the most specific active organization scope containing both companies.

    When none exists, create ``auto-<low id>-<high id>`` with exactly those two
    companies. Returns ``(scope, created)``.
    """
    from organization.models import OrganizationScope, OrganizationScopeMembership

    candidate_ids = (
        OrganizationScope.objects.filter(is_active=True, memberships__company_id=company_a.pk)
        .filter(memberships__company_id=company_b.pk)
        .values_list("id", flat=True)
    )
    scope = (
        OrganizationScope.objects.filter(pk__in=list(candidate_ids))
        .annotate(company_count=Count("memberships"))
        .order_by("company_count", "id")
        .first()
    )
    if scope is not None:
        return scope, False

    low, high = sorted([company_a, company_b], key=lambda company: company.pk)
    scope, created = OrganizationScope.objects.get_or_create(
        code=f"auto-{low.pk}-{high.pk}",
        defaults={"name": f"Auto: {low.name} + {high.name}"[:160], "created_by": _actor_user(actor, request)},
    )
    if not scope.is_active:
        scope.is_active = True
        scope.save(update_fields=["is_active", "updated_at"])
    for company in (low, high):
        OrganizationScopeMembership.objects.get_or_create(scope=scope, company=company)
    if created:
        audit(
            request,
            "organization_scope_created",
            entity="organization_scope",
            entity_id=scope.id,
            actor=actor,
            metadata={"company_ids": [low.pk, high.pk], "source": "manager_assignment"},
        )
    return scope, created


def _revoke_assignments(assignments, *, actor, request, source: str, reason: str) -> list[int]:
    ids = [assignment.pk for assignment in assignments]
    if not ids:
        return []
    _assignment_model().objects.filter(pk__in=ids).update(
        is_active=False,
        revoked_at=timezone.now(),
        revoked_by=_actor_user(actor, request),
        updated_at=timezone.now(),
    )
    for assignment in assignments:
        audit(
            request,
            "cross_company_manager_assignment_revoked",
            entity="cross_company_manager_assignment",
            entity_id=assignment.pk,
            actor=actor,
            metadata={
                "employee_profile_id": assignment.employee_id,
                "manager_profile_id": assignment.manager_profile_id,
                "scope_id": assignment.scope_id,
                "source": source,
                "reason": reason,
            },
        )
    return ids


def revoke_cross_company_manager_assignments(employee_ids, *, actor=None, request=None, source: str) -> list[int]:
    """Revoke the active cross-company manager assignment of each employee (bulk paths)."""
    assignments = list(
        _assignment_model().objects.filter(employee_id__in=list(employee_ids), is_active=True, revoked_at__isnull=True)
    )
    return _revoke_assignments(assignments, actor=actor, request=request, source=source, reason="manager_replaced")


def _set_direct_manager(employee: EmployeeProfile, manager_profile: EmployeeProfile | None) -> bool:
    manager_profile_id = getattr(manager_profile, "pk", None)
    legacy_manager_id = getattr(manager_profile, "user_id", None)
    if employee.manager_profile_id == manager_profile_id and employee.manager_id == legacy_manager_id:
        return False
    # update() rather than save(): the manager was validated above and the DB
    # tenant trigger re-checks it, while unrelated legacy field problems on the
    # profile must not block a manager change. The legacy user field is kept in sync.
    now = timezone.now()
    EmployeeProfile.objects.filter(pk=employee.pk).update(
        manager_profile=manager_profile, manager_id=legacy_manager_id, updated_at=now
    )
    employee.manager_profile = manager_profile
    employee.manager_id = legacy_manager_id
    employee.updated_at = now
    return True


def set_employee_manager(
    employee: EmployeeProfile,
    manager_profile: EmployeeProfile | None,
    *,
    actor=None,
    request=None,
    source: str = "hr_update",
    scope=None,
    reason: str = "",
) -> ManagerChange:
    """Give ``employee`` exactly one manager (or none). The single write path for managers.

    - ``None`` clears the direct manager and revokes the cross-company assignment.
    - A same-company manager becomes ``manager_profile``; any cross-company
      assignment is revoked.
    - A manager from another company clears ``manager_profile`` and keeps exactly
      one active, non-expiring assignment with every manager capability.

    Raises ``django.core.exceptions.ValidationError`` for an invalid manager.
    """
    model = _assignment_model()
    from contract_ratings.services import lock_open_ratings_awaiting_manager, reassign_open_ratings_to_current_manager

    with transaction.atomic():
        # Open contract ratings first (the order contract-rating writes use), then
        # the employee, so concurrent manager changes serialize without deadlock.
        lock_open_ratings_awaiting_manager([employee.pk])
        list(EmployeeProfile.objects.select_for_update().filter(pk=employee.pk).values_list("pk", flat=True))
        employee.refresh_from_db(fields=["manager_profile", "manager", "company", "user", "is_archived"])
        active_assignments = list(
            model.objects.select_for_update(of=("self",))
            .filter(employee_id=employee.pk, is_active=True, revoked_at__isnull=True)
            .select_related("manager_profile", "scope")
            .order_by("-id")
        )
        previous_manager = active_assignments[0].manager_profile if active_assignments else employee.manager_profile
        result = ManagerChange(manager_profile=manager_profile)

        if manager_profile is None:
            result.revoked_assignment_ids = _revoke_assignments(
                active_assignments, actor=actor, request=request, source=source, reason="manager_cleared"
            )
            _set_direct_manager(employee, None)
        elif manager_profile.company_id == employee.company_id:
            validate_manager_assignment(employee, manager_profile)
            result.revoked_assignment_ids = _revoke_assignments(
                active_assignments, actor=actor, request=request, source=source, reason="replaced_by_direct_manager"
            )
            _set_direct_manager(employee, manager_profile)
        else:
            validate_cross_company_manager_assignment(employee, manager_profile, scope=scope)
            # Keep the current row for the same manager (an explicit scope must match).
            reusable = next(
                (
                    assignment
                    for assignment in active_assignments
                    if assignment.manager_profile_id == manager_profile.pk
                    and (scope is None or assignment.scope_id == scope.pk)
                    and assignment.scope.is_active
                    and assignment.start_at <= timezone.now()
                ),
                None,
            )
            if reusable is None and scope is None:
                scope, scope_created = get_or_create_manager_scope(
                    employee.company, manager_profile.company, actor=actor, request=request
                )
                if scope_created:
                    result.created_scope_id = scope.pk
            result.revoked_assignment_ids = _revoke_assignments(
                [assignment for assignment in active_assignments if assignment is not reusable],
                actor=actor,
                request=request,
                source=source,
                reason="replaced_by_cross_company_manager",
            )
            _set_direct_manager(employee, None)
            full_capabilities = full_manager_capabilities()
            if reusable is not None:
                update_fields = []
                if sorted(reusable.capabilities or []) != sorted(full_capabilities):
                    reusable.capabilities = full_capabilities
                    update_fields.append("capabilities")
                if reason and reusable.reason != reason:
                    reusable.reason = reason
                    update_fields.append("reason")
                if update_fields:
                    reusable.save(update_fields=[*update_fields, "updated_at"])
                result.assignment = reusable
            else:
                assignment = model(
                    employee=employee,
                    manager_profile=manager_profile,
                    scope=scope,
                    start_at=timezone.now(),
                    capabilities=full_capabilities,
                    reason=reason,
                    created_by=_actor_user(actor, request),
                )
                assignment.save()
                result.assignment = assignment
                result.assignment_created = True
                audit(
                    request,
                    "cross_company_manager_assignment_created",
                    entity="cross_company_manager_assignment",
                    entity_id=assignment.pk,
                    actor=actor,
                    metadata={
                        "employee_profile_id": employee.pk,
                        "manager_profile_id": manager_profile.pk,
                        "scope_id": scope.pk,
                        "source": source,
                    },
                )

        result.changed = getattr(previous_manager, "pk", None) != getattr(manager_profile, "pk", None)
        log_manager_assignment_change(
            employee=employee,
            previous_manager=previous_manager,
            new_manager=manager_profile,
            changed_by=actor,
            request=request,
            source=source,
        )
        if previous_manager is not None and employee.manager_profile_id is None:
            # Pending manager-stage work the new manager cannot act on goes to HR.
            reroute_pending_manager_requests(employee, actor=_actor_user(actor, request))
        # Open contract ratings move to the new manager; submitted and decided ones stay as they are.
        result.reassigned_contract_rating_ids = [
            change["rating_id"]
            for change in reassign_open_ratings_to_current_manager(
                [employee], actor=_actor_user(actor, request), request=request, source=source
            )
        ]

    employee.__dict__.pop(CURRENT_CROSS_COMPANY_ATTR, None)
    if employee.company_id:
        from core.response_cache import bump_cache_version
        from employees.cache import employee_list_cache_version_key

        bump_cache_version(employee_list_cache_version_key(employee.company_id))
    return result


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
        "PermissionRequest": ("pending_manager", "pending_hr", "employee_profile"),
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
    if get_valid_manager_user(profile, cross_company_capability=manager_capability_for(instance)):
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
    from permission_requests.models import PermissionRequest

    requests = [
        *PermissionRequest.objects.filter(
            employee_profile_id__in=profile_ids,
            status=PermissionRequest.Status.PENDING_MANAGER,
        ),
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


def manager_option_exclusion_ids(employee: EmployeeProfile) -> set[int]:
    """The employee and everyone who reports to them, directly or transitively.

    Picking any of them as the employee's manager would create a reporting cycle.
    """
    excluded = {employee.pk}
    frontier = {employee.pk}
    while frontier:
        reports = set(
            EmployeeProfile.objects.filter(manager_profile_id__in=frontier).values_list("id", flat=True)
        ) | set(
            current_cross_company_assignments()
            .filter(manager_profile_id__in=frontier)
            .values_list("employee_id", flat=True)
        )
        frontier = reports - excluded
        excluded |= frontier
    return excluded
