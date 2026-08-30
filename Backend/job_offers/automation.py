import re
from datetime import date

from django.contrib.auth import get_user_model
from django.utils import timezone

from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from .models import JobOffer

User = get_user_model()

ROLE_TITLES = {
    "HRManager": "HR Manager",
    "SystemAdmin": "System Administrator",
    "Manager": "Manager",
    "CEO": "Chief Executive Officer",
    "CFO": "Chief Financial Officer",
}


def normalized_company_code(company: OrganizationNode) -> str:
    code = re.sub(r"[^A-Z0-9]+", "-", (company.code or "").upper()).strip("-")
    return code or str(company.pk)


def generate_reference_number(company: OrganizationNode, offer_date: date | None = None) -> str:
    """Return the next reference while the caller holds a lock on ``company``."""

    year = (offer_date or timezone.localdate()).year
    prefix = f"JO-{normalized_company_code(company)}-{year}-"
    sequence = 0
    for reference in JobOffer.objects.filter(
        company=company,
        reference_number__startswith=prefix,
    ).values_list("reference_number", flat=True):
        suffix = reference.removeprefix(prefix)
        if suffix.isdigit():
            sequence = max(sequence, int(suffix))

    while True:
        sequence += 1
        reference = f"{prefix}{sequence:04d}"
        if not JobOffer.objects.filter(company=company, reference_number=reference).exists():
            return reference


def signer_snapshot(user: User) -> dict[str, object]:
    name = (getattr(user, "full_name", "") or getattr(user, "email", "") or "").strip()
    profile = EmployeeProfile.objects.select_related("position_ref").filter(user=user).first()

    title = ""
    if profile:
        title = (profile.job_title or profile.job_title_en or "").strip()
        if not title and profile.position_ref_id:
            title = (profile.position_ref.name or "").strip()

    if not title:
        group_names = set(user.groups.values_list("name", flat=True))
        for group_name, label in ROLE_TITLES.items():
            if group_name in group_names:
                title = label
                break
    if not title:
        title = "System Administrator" if user.is_superuser else "HR Manager"

    return {
        "hr_signer_user": user,
        "hr_signer_name": name,
        "hr_signer_title": title,
    }
