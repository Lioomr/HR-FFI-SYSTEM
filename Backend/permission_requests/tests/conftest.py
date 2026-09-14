import itertools
from datetime import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from permission_requests.models import PermissionRequest

User = get_user_model()
_sequence = itertools.count(1)


@pytest.fixture(autouse=True)
def _plain_http(settings):
    settings.SECURE_SSL_REDIRECT = False


@pytest.fixture(autouse=True)
def notifications():
    """Capture outbound notifications; individual tests make them fail on purpose."""

    with (
        patch("permission_requests.services.notify_users_for_pending_status") as pending,
        patch("permission_requests.services.notify_profile_request_status_whatsapp") as status_update,
        # pytest-django's transaction wrapper otherwise discards callbacks at
        # teardown. Exercise our production on_commit scheduling immediately.
        patch("permission_requests.services.transaction.on_commit", side_effect=lambda callback: callback()),
    ):
        yield SimpleNamespace(pending=pending, status=status_update)


@pytest.fixture
def company(db):
    return OrganizationNode.objects.create(
        code="PERM_A", name="Permission Company A", node_type=OrganizationNode.NodeType.COMPANY
    )


@pytest.fixture
def other_company(db):
    return OrganizationNode.objects.create(
        code="PERM_B", name="Permission Company B", node_type=OrganizationNode.NodeType.COMPANY
    )


@pytest.fixture
def make_user(db, company):
    def _make(role=None, *, tenant=None, manager=None, profile=True, name=None):
        tenant = tenant or company
        number = next(_sequence)
        label = name or f"{role or 'Employee'} {number}"
        user = User.objects.create_user(email=f"perm-{number}@ffi.test", password="StrongPass123!", full_name=label)
        if role:
            user.groups.add(Group.objects.get_or_create(name=role)[0])
        if role in {"HRManager", "SystemAdmin"}:
            UserOrganizationAccess.objects.create(user=user, organization=tenant)
        if profile:
            EmployeeProfile.objects.create(
                user=user,
                company=tenant,
                employee_id=f"PERM-{number:05d}",
                full_name=label,
                manager_profile=manager.employee_profile if manager is not None else None,
            )
        return user

    return _make


@pytest.fixture
def client_for(company):
    def _client(user, tenant=None):
        client = APIClient()
        client.force_authenticate(user=user)
        client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str((tenant or company).pk))
        return client

    return _client


@pytest.fixture
def team(make_user):
    manager = make_user("Manager", name="Maha Manager")
    employee = make_user("Employee", manager=manager, name="Eyad Employee")
    hr = make_user("HRManager", name="Huda HR")
    return SimpleNamespace(manager=manager, employee=employee, hr=hr)


@pytest.fixture
def make_request(db):
    """Seed a request directly, bypassing the API, for state-dependent tests."""

    def _make(user, *, status=PermissionRequest.Status.PENDING_MANAGER, **fields):
        profile = user.employee_profile
        values = {
            "employee": user,
            "employee_profile": profile,
            "company": profile.company,
            "reference_no": f"PERM-TEST-{next(_sequence):05d}",
            "request_date": timezone.localdate(),
            "from_time": time(9, 0),
            "to_time": time(10, 0),
            "duration_minutes": 60,
            "exit_type": PermissionRequest.ExitType.PERSONAL,
            "reason": "Seeded request",
            "status": status,
        }
        values.update(fields)
        return PermissionRequest.objects.create(**values)

    return _make
