"""Allocate company-scoped, human-readable employee IDs."""

import re
import secrets
import string

from django.db import transaction
from django.db.models import Q

from employees.models import EmployeeIdAlias, EmployeeProfile
from organization.models import OrganizationNode

SEQUENTIAL_COMPANY_PREFIXES = {"FFI": "FFI", "ASECO_PRO": "ASECO", "ATHROYA": "ATH"}


def allocate_employee_id(company: OrganizationNode) -> str:
    """Return the next ID while holding the company's row lock until profile creation.

    The caller must create the profile in the same transaction. Until a company
    has migrated every legacy profile, it continues issuing the legacy format.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("Employee IDs must be allocated inside transaction.atomic().")

    company = OrganizationNode.objects.select_for_update().get(pk=company.pk)
    prefix = SEQUENTIAL_COMPANY_PREFIXES[company.code]
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d{{4}})$")
    company_codes = list(EmployeeProfile.objects.filter(company=company).values_list("employee_id", flat=True))
    if any(pattern.fullmatch(code) is None for code in company_codes):
        for _ in range(20):
            candidate = f"{prefix}-{''.join(secrets.choice(string.digits) for _ in range(6))}"
            if EmployeeProfile.objects.filter(employee_id=candidate).exists():
                continue
            if EmployeeIdAlias.objects.filter(Q(old_employee_id=candidate) | Q(new_employee_id=candidate)).exists():
                continue
            return candidate
        raise ValueError(f"Failed to generate a unique legacy employee ID for {company.code}.")

    used = set(
        EmployeeProfile.objects.filter(employee_id__startswith=f"{prefix}-").values_list("employee_id", flat=True)
    )
    alias_rows = EmployeeIdAlias.objects.filter(
        Q(old_employee_id__startswith=f"{prefix}-") | Q(new_employee_id__startswith=f"{prefix}-")
    ).values_list("old_employee_id", "new_employee_id")
    for old_code, new_code in alias_rows:
        used.add(old_code)
        used.add(new_code)

    highest = max((int(match.group(1)) for code in used if (match := pattern.fullmatch(code))), default=2)

    for number in range(max(3, highest + 1), 10000):
        candidate = f"{prefix}-{number:04d}"
        if candidate not in used:
            return candidate
    raise ValueError(f"Employee ID sequence exhausted for {company.code}.")
