"""Visa expiry for expiring-document views.

A visa has no field on the employee profile: its expiry is the ``exit_before``
date on the employee's newest VISA document in the document archive (entered by
HR on upload or read by OCR). A newer visa replaces the older one, so an older
visa's date never counts once a new visa is uploaded.
"""

from django.db.models import OuterRef, Subquery

from employees.models import EmployeeDocument

VISA_EXPIRY_FIELD = "visa_expiry"


def annotate_visa_expiry(profile_qs):
    """Annotate each profile with ``visa_expiry``: its newest visa's exit-before date (or None)."""
    newest_visa = (
        EmployeeDocument.objects.filter(
            employee_profile=OuterRef("pk"),
            document_type=EmployeeDocument.DocumentType.VISA,
            deletion_started_at__isnull=True,
        )
        .order_by("-created_at", "-id")
        .values("exit_before")[:1]
    )
    return profile_qs.annotate(**{VISA_EXPIRY_FIELD: Subquery(newest_visa)})
