"""Shared fixtures for the employee signature tests."""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group

from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess


@pytest.fixture
def world(db):
    """Two companies, an owner, a colleague, local HR, foreign HR, and an admin."""

    company = OrganizationNode.objects.create(code="SIG-A", name="Sig A", node_type="company")
    foreign = OrganizationNode.objects.create(code="SIG-B", name="Sig B", node_type="company")
    users = {}
    for role in ("owner", "colleague", "hr", "foreign_hr", "admin"):
        user = get_user_model().objects.create_user(email=f"sig-{role}@example.com")
        tenant = foreign if role.startswith("foreign") else company
        EmployeeProfile.objects.create(user=user, company=tenant, employee_id=f"SIG-{role}", full_name=role)
        if role in {"hr", "foreign_hr", "admin"}:
            group = "SystemAdmin" if role == "admin" else "HRManager"
            user.groups.add(Group.objects.get_or_create(name=group)[0])
            UserOrganizationAccess.objects.create(user=user, organization=tenant)
        users[role] = user
    return {"company": company, "foreign": foreign, "users": users}
