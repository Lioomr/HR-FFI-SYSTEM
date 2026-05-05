from __future__ import annotations

from typing import Iterable

from django.contrib.auth import get_user_model

from core.permissions import get_role

from .models import OrganizationNode

User = get_user_model()

HEAD_OFFICE_CODE = "HEAD_OFFICE"
DEFAULT_COMPANY_CODE = "FFI"
ACTIVE_COMPANY_HEADER = "HTTP_X_ACTIVE_COMPANY_ID"


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
        if assigned_ids:
            return list(qs.filter(id__in=assigned_ids).order_by("node_type", "name", "id"))
        return list(qs.filter(code__in=[HEAD_OFFICE_CODE, DEFAULT_COMPANY_CODE]).order_by("node_type", "name", "id"))

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
        org.id
        for org in get_user_accessible_organizations(user)
        if org.node_type == OrganizationNode.NodeType.COMPANY
    }


def user_has_all_company_access(user) -> bool:
    accessible = get_user_accessible_company_ids(user)
    all_companies = set(
        OrganizationNode.objects.filter(node_type=OrganizationNode.NodeType.COMPANY, is_active=True).values_list("id", flat=True)
    )
    return bool(accessible) and accessible == all_companies


def get_active_organization_for_request(request):
    accessible = get_user_accessible_organizations(request.user)
    if not accessible:
        return None

    requested_id = (request.META.get(ACTIVE_COMPANY_HEADER) or "").strip()
    if requested_id.isdigit():
        for org in accessible:
            if org.id == int(requested_id):
                return org

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
    if is_head_office_context(request):
        raise ValueError("Select a company instead of Main Head Office to perform write actions.")


def filter_queryset_by_company_scope(queryset, request, field_name: str = "company_id"):
    accessible_company_ids = get_user_accessible_company_ids(request.user)
    if not accessible_company_ids:
        return queryset.none()

    active_org = get_active_organization_for_request(request)
    query_key = request.query_params.get("company_id")
    if query_key and str(query_key).isdigit():
        requested_id = int(query_key)
        if requested_id in accessible_company_ids:
            return queryset.filter(**{field_name: requested_id})
        return queryset.none()

    if active_org and active_org.node_type == OrganizationNode.NodeType.HEAD_OFFICE:
        return queryset.filter(**{f"{field_name}__in": list(accessible_company_ids)})

    active_company = get_active_company_for_request(request)
    if active_company:
        return queryset.filter(**{field_name: active_company.id})

    return queryset.filter(**{f"{field_name}__in": list(accessible_company_ids)})


def filter_queryset_by_accessible_companies(queryset, request, field_name: str = "company_id", include_null: bool = False):
    """
    Scope direct object lookups to every company the user can access.

    List views should usually use filter_queryset_by_company_scope because they
    intentionally follow the active company selector. Direct links from emails,
    workflow inboxes, and notifications should use this helper so a valid object
    does not disappear only because the user currently selected a different
    accessible company.
    """
    accessible_company_ids = get_user_accessible_company_ids(request.user)
    if not accessible_company_ids:
        return queryset.none()

    scoped = queryset.filter(**{f"{field_name}__in": list(accessible_company_ids)})
    if include_null:
        from django.db.models import Q

        scoped = queryset.filter(Q(**{f"{field_name}__in": list(accessible_company_ids)}) | Q(**{field_name: None}))
    return scoped


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
