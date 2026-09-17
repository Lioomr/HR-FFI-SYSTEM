from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from contract_ratings.criteria import CRITERIA
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess


def answers(score=85, grade="VERY_GOOD"):
    return {item["code"]: {"grade": grade, "score": score, "remark": "private answer"} for item in CRITERIA}


@pytest.fixture(autouse=True)
def notifications():
    with patch(
        "contract_ratings.tasks.dispatch_notification_channels",
        return_value={"notification": object(), "created": True},
    ) as dispatch:
        yield dispatch


@pytest.fixture
def world(db):
    company = OrganizationNode.objects.create(code="RATING-A", name="Rating A", node_type="company")
    foreign = OrganizationNode.objects.create(code="RATING-B", name="Rating B", node_type="company")
    users = {}
    for role in ("employee", "manager", "hr", "ceo", "outsider", "foreign_hr", "admin"):
        user = get_user_model().objects.create_user(email=f"rating-{role}@example.com", full_name=role)
        tenant = foreign if role == "foreign_hr" else company
        EmployeeProfile.objects.create(user=user, company=tenant, employee_id=f"RATING-{role}", full_name=role)
        group = {"hr": "HRManager", "foreign_hr": "HRManager", "ceo": "CEO", "admin": "SystemAdmin"}.get(role)
        if group:
            user.groups.add(Group.objects.get_or_create(name=group)[0])
        UserOrganizationAccess.objects.create(user=user, organization=tenant)
        users[role] = user
    profile = users["employee"].employee_profile
    profile.manager_profile = users["manager"].employee_profile
    profile.contract_date = timezone.localdate() - timedelta(days=275)
    profile.contract_expiry = timezone.localdate() + timedelta(days=90)
    profile.basic_salary, profile.total_salary = Decimal("1000.00"), Decimal("1000.00")
    profile.save()
    client = APIClient()
    client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(company.id))
    return SimpleNamespace(company=company, foreign=foreign, profile=profile, client=client, **users)
