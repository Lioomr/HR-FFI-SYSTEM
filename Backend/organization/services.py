from __future__ import annotations

from typing import Iterable

from django.contrib.auth import get_user_model
from rest_framework.exceptions import PermissionDenied

from core.permissions import get_role

from .models import OrganizationNode, OrganizationScope

User = get_user_model()

HEAD_OFFICE_CODE = "HEAD_OFFICE"
DEFAULT_COMPANY_CODE = "FFI"
ACTIVE_COMPANY_HEADER = "HTTP_X_ACTIVE_COMPANY_ID"
COMPANY_QUERY_PARAM = "company_id"
ACTIVE_SCOPE_HEADER = "HTTP_X_ORGANIZATION_SCOPE_ID"
SCOPE_QUERY_PARAM = "organization_scope_id"


def seed_default_organization() -> None:
    head_office, _ = OrganizationNode.objects.get_or_create(
        code=HEAD_OFFICE_CODE,
        defaults={
            "name": "Main Head Office",
            "node_type": OrganizationNode.NodeType.HEAD_OFFICE,
            "employee_id_prefix": "",
        },
    )

    for code, name, prefix in [
        ("FFI", "FFI", "FFI"),
        ("ASECO_PRO", "Aseco Pro", "ASECO"),
        ("ATHROYA", "Athroya", "ATH"),
    ]:
        OrganizationNode.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "node_type": OrganizationNode.NodeType.COMPANY,
                "parent": head_office,
                "employee_id_prefix": prefix,
            },
        )


def get_default_company() -> OrganizationNode:
    seed_default_organization()
    return OrganizationNode.objects.get(code=DEFAULT_COMPANY_CODE)


def get_head_office_node() -> OrganizationNode:
    seed_default_organization()
    return OrganizationNode.objects.get(code=HEAD_OFFICE_CODE)


def get_user_accessible_organizations(user) -> list[OrganizationNode]:
    if not user or not user.is_authenticated:
        return []

    seed_default_organization()
    role = get_role(user)
    qs = OrganizationNode.objects.filter(is_active=True).select_related("parent")
    if role == "SystemAdmin":
        return list(qs.order_by("node_type", "name", "id"))

    if role == "HRManager":
        assigned_ids = list(user.organization_access_entries.values_list("organization_id", flat=True))
        return list(qs.filter(id__in=assigned_ids).order_by("node_type", "name", "id"))

    profile = getattr(user, "employee_profile", None)
    if profile and profile.company_id:
        return list(qs.filter(id=profile.company_id))
    return []


def get_default_organization_for_user(user):
    accessible = get_user_accessible_organizations(user)
    if not accessible:
        return None

    for org in accessible:
        if org.node_type == OrganizationNode.NodeType.COMPANY:
            return org
    return accessible[0]


def get_user_accessible_company_ids(user) -> set[int]:
    return {
        org.id for org in get_user_accessible_organizations(user) if org.node_type == OrganizationNode.NodeType.COMPANY
    }


def _request_query_params(request):
    return getattr(request, "query_params", getattr(request, "GET", {}))


def _parse_requested_organization_id(raw_value, *, source: str) -> int | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    if not value.isdigit() or int(value) <= 0:
        raise PermissionDenied(f"Invalid {source} company selection.")
    return int(value)


def _get_requested_organization_id(request) -> int | None:
    query_params = _request_query_params(request)
    query_values = (
        query_params.getlist(COMPANY_QUERY_PARAM)
        if hasattr(query_params, "getlist")
        else ([query_params.get(COMPANY_QUERY_PARAM)] if COMPANY_QUERY_PARAM in query_params else [])
    )
    if len(query_values) > 1:
        raise PermissionDenied("Duplicate company query parameters are not allowed.")

    query_id = (
        _parse_requested_organization_id(query_values[0], source="query parameter") if query_values else None
    )
    header_id = _parse_requested_organization_id(
        request.META.get(ACTIVE_COMPANY_HEADER),
        source="header",
    )
    if query_id is not None and header_id is not None and query_id != header_id:
        raise PermissionDenied("Company query parameter and header selections must match.")
    return query_id if query_id is not None else header_id


def get_requested_company_id(request) -> int | None:
    """Return a syntactically valid requested company selector without granting access."""
    return _get_requested_organization_id(request)


def _get_requested_scope_id(request) -> int | None:
    query_params = _request_query_params(request)
    query_values = (
        query_params.getlist(SCOPE_QUERY_PARAM)
        if hasattr(query_params, "getlist")
        else ([query_params.get(SCOPE_QUERY_PARAM)] if SCOPE_QUERY_PARAM in query_params else [])
    )
    if len(query_values) > 1:
        raise PermissionDenied("Duplicate organization scope query parameters are not allowed.")
    query_id = _parse_requested_organization_id(query_values[0], source="scope query parameter") if query_values else None
    header_id = _parse_requested_organization_id(
        request.META.get(ACTIVE_SCOPE_HEADER), source="scope header"
    )
    if query_id is not None and header_id is not None and query_id != header_id:
        raise PermissionDenied("Organization scope query parameter and header selections must match.")
    return query_id if query_id is not None else header_id


def get_requested_organization_scope(request) -> OrganizationScope | None:
    """Resolve a requested scope as context only; grants are checked by the caller."""
    scope_id = _get_requested_scope_id(request)
    if scope_id is None:
        return None
    try:
        scope = OrganizationScope.objects.prefetch_related("memberships").get(pk=scope_id, is_active=True)
    except OrganizationScope.DoesNotExist as exc:
        raise PermissionDenied("You do not have access to the requested organization scope.") from exc

    selected_company_id = _get_requested_organization_id(request)
    if selected_company_id is not None and not scope.memberships.filter(company_id=selected_company_id).exists():
        raise PermissionDenied("The selected company is not included in the requested organization scope.")
    return scope


def get_scope_company_ids(scope: OrganizationScope) -> set[int]:
    return set(
        scope.memberships.filter(
            company__node_type=OrganizationNode.NodeType.COMPANY,
            company__is_active=True,
        ).values_list("company_id", flat=True)
    )


def user_has_all_company_access(user) -> bool:
    accessible = get_user_accessible_company_ids(user)
    all_companies = set(
        OrganizationNode.objects.filter(node_type=OrganizationNode.NodeType.COMPANY, is_active=True).values_list(
            "id", flat=True
        )
    )
    return bool(accessible) and accessible == all_companies


def get_active_organization_for_request(request):
    requested_id = _get_requested_organization_id(request)
    accessible = get_user_accessible_organizations(request.user)
    if not accessible:
        if requested_id is not None:
            raise PermissionDenied("You do not have access to the requested company.")
        return None

    if requested_id is not None:
        for org in accessible:
            if org.id == requested_id:
                return org
        raise PermissionDenied("You do not have access to the requested company.")

    company_nodes = [org for org in accessible if org.node_type == OrganizationNode.NodeType.COMPANY]
    if company_nodes:
        return company_nodes[0]
    return accessible[0]


def get_active_company_for_request(request):
    org = get_active_organization_for_request(request)
    if org and org.node_type == OrganizationNode.NodeType.COMPANY:
        return org
    return None


def is_head_office_context(request) -> bool:
    org = get_active_organization_for_request(request)
    return bool(org and org.node_type == OrganizationNode.NodeType.HEAD_OFFICE)


def ensure_company_write_allowed(request):
    if get_active_company_for_request(request) is None:
        raise PermissionDenied("Select an active company to perform write actions.")


def filter_queryset_by_company_scope(queryset, request, field_name: str = "company_id"):
    """Strict list scope: only the selected active company, never NULL rows."""
    return filter_queryset_by_active_company(queryset, request, field_name=field_name)


def filter_queryset_by_active_company(queryset, request, field_name: str = "company_id"):
    """Scope a company-sensitive queryset to exactly one authorized active company."""
    active_company = get_active_company_for_request(request)
    if active_company is None:
        if get_active_organization_for_request(request) is not None:
            raise PermissionDenied("Select an active company for this request.")
        return queryset.none()
    return queryset.filter(**{field_name: active_company.id})


def filter_queryset_by_accessible_companies(
    queryset, request, field_name: str = "company_id", include_null: bool = False
):
    """
    Scope direct object lookups to every company the user can access.

    Use only for an explicitly authorized HR/SystemAdmin multi-company workflow.
    A selected company still narrows the result to that company; an authorized
    head-office context expands it to all accessible companies.
    """
    if include_null:
        raise ValueError("NULL-company rows require a domain-specific legacy-data workflow.")

    # A supplied selector is context, never authorization. Company context keeps
    # even explicit workflows single-company; head-office context is the only
    # way an authorized HR/Admin workflow expands to all accessible companies.
    active_org = get_active_organization_for_request(request)

    role = get_role(request.user)
    if role not in {"SystemAdmin", "HRManager"}:
        return filter_queryset_by_employee_own_company(queryset, request, field_name=field_name)

    accessible_company_ids = get_user_accessible_company_ids(request.user)
    if not accessible_company_ids:
        return queryset.none()
    if active_org and active_org.node_type == OrganizationNode.NodeType.COMPANY:
        return queryset.filter(**{field_name: active_org.id})
    return queryset.filter(**{f"{field_name}__in": list(accessible_company_ids)})


def filter_queryset_by_employee_own_company(queryset, request, field_name: str = "company_id"):
    """Scope employee/manager/CEO data to the authenticated employee's company."""
    profile = getattr(request.user, "employee_profile", None)
    company_id = getattr(profile, "company_id", None)
    if not company_id:
        return queryset.none()

    active_company = get_active_company_for_request(request)
    if active_company is None or active_company.id != company_id:
        raise PermissionDenied("The selected company does not match your employee company.")
    return queryset.filter(**{field_name: company_id})


def serialize_organization(node: OrganizationNode) -> dict:
    return {
        "id": node.id,
        "code": node.code,
        "name": node.name,
        "node_type": node.node_type,
        "parent_id": node.parent_id,
        "employee_id_prefix": node.employee_id_prefix,
        "is_active": node.is_active,
    }


def serialize_organizations(nodes: Iterable[OrganizationNode]) -> list[dict]:
    return [serialize_organization(node) for node in nodes]
