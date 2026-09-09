from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from audit.models import AuditLog
from employees.models import EmployeeProfile
from loans.models import LoanRequest
from organization.models import OrganizationNode, UserOrganizationAccess


@pytest.mark.django_db
@pytest.mark.parametrize("prefix", ["loan-requests", "hr/loan-requests"])
@pytest.mark.parametrize("trailing_slash", ["", "/"])
@pytest.mark.parametrize(
    ("identity", "expected"),
    [
        ("owner", 200),
        ("other", 403),
        ("foreign", 404),
        ("hr", 200),
        ("foreign_hr", 404),
        ("admin", 200),
        ("anonymous", 401),
    ],
)
def test_pdf_requires_owner_or_authorized_hr_admin_on_every_alias(prefix, trailing_slash, identity, expected):
    company = OrganizationNode.objects.create(code="PDF-A", name="PDF A", node_type="company")
    foreign_company = OrganizationNode.objects.create(code="PDF-B", name="PDF B", node_type="company")
    users = {}
    for role in ("owner", "other", "foreign", "hr", "foreign_hr", "admin"):
        user = get_user_model().objects.create_user(email=f"pdf-{role}@example.com")
        tenant = foreign_company if role.startswith("foreign") else company
        EmployeeProfile.objects.create(user=user, company=tenant, employee_id=f"PDF-{role}", full_name=role)
        if role in {"hr", "foreign_hr", "admin"}:
            group = "SystemAdmin" if role == "admin" else "HRManager"
            user.groups.add(Group.objects.get_or_create(name=group)[0])
            UserOrganizationAccess.objects.create(user=user, organization=tenant)
        users[role] = user
    loan = LoanRequest.objects.create(
        employee=users["owner"],
        employee_profile=users["owner"].employee_profile,
        company=company,
        requested_amount=Decimal("100.00"),
    )
    client = APIClient()
    client.force_authenticate(users.get(identity))
    with patch("loans.views._build_loan_request_pdf", return_value=b"%PDF-test") as render:
        headers = (
            {"HTTP_X_ACTIVE_COMPANY_ID": str(users[identity].employee_profile.company_id)}
            if identity != "anonymous"
            else {}
        )
        response = client.get(f"/api/loans/{prefix}/{loan.id}/pdf{trailing_slash}", secure=True, **headers)
    assert response.status_code == expected
    assert render.call_count == int(expected == 200)
    if expected == 200:
        assert response["Cache-Control"] == "private, no-store"
        assert response["X-Content-Type-Options"] == "nosniff"
        assert response["Content-Disposition"] == f'attachment; filename="loan_request_{loan.id}.pdf"'
        assert AuditLog.objects.filter(
            actor=users[identity],
            action="loan_request_exported_pdf",
            entity="LoanRequest",
            entity_id=str(loan.id),
        ).exists()
