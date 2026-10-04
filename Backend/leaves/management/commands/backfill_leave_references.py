from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from audit.models import AuditLog
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest
from leaves.references import format_leave_reference, is_sequential_employee_code
from organization.models import OrganizationNode


class Command(BaseCommand):
    help = "Preview or backfill leave references after a company's employee IDs have been renumbered."

    def add_arguments(self, parser):
        parser.add_argument("--company-code", required=True)
        parser.add_argument("--apply", action="store_true", help="Write references; the default is preview only.")

    def handle(self, *args, **options):
        company = OrganizationNode.objects.filter(code=options["company_code"]).first()
        if company is None:
            raise CommandError(f"Unknown company code: {options['company_code']}")

        updated = 0
        skipped = 0
        with transaction.atomic():
            profiles = EmployeeProfile.objects.select_for_update().filter(company=company).order_by("id")
            for profile in profiles:
                missing = list(
                    LeaveRequest.objects.filter(company=company, employee_profile=profile, reference_no__isnull=True)
                    .order_by("created_at", "id")
                    .values_list("id", flat=True)
                )
                if not missing:
                    continue
                if not is_sequential_employee_code(profile.employee_id):
                    skipped += len(missing)
                    self.stdout.write(f"SKIP employee {profile.pk}: {profile.employee_id} is not a four-digit code")
                    continue
                used = set(
                    LeaveRequest.objects.filter(employee_profile=profile, reference_sequence__isnull=False).values_list(
                        "reference_sequence", flat=True
                    )
                )
                sequence = 1
                for request_id in missing:
                    while sequence in used:
                        sequence += 1
                    reference = format_leave_reference(profile.employee_id, sequence)
                    self.stdout.write(f"{request_id}: {reference}")
                    if options["apply"]:
                        LeaveRequest.objects.filter(pk=request_id, reference_no__isnull=True).update(
                            reference_no=reference, reference_sequence=sequence
                        )
                        AuditLog.objects.create(
                            action="leave_reference_backfilled",
                            entity="LeaveRequest",
                            entity_id=str(request_id),
                            metadata={
                                "reference_no": reference,
                                "company_id": company.pk,
                                "employee_profile_id": profile.pk,
                            },
                        )
                    used.add(sequence)
                    sequence += 1
                    updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Applied' if options['apply'] else 'Previewed'} {updated} references; skipped {skipped} requests."
            )
        )
