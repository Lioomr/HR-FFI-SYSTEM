from datetime import date
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from employees.models import EmployeeProfile
from job_offers.models import JobOffer
from job_offers.pdf import build_job_offer_pdf
from job_offers.starting_work_pdf import StartingWorkAcknowledgmentData, build_starting_work_acknowledgment_pdf


class Command(BaseCommand):
    help = "Generate representative Job Offer and Starting Work PDF examples without database writes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output-dir",
            default=str(Path(settings.BASE_DIR).parent / "output" / "hr_document_examples"),
            help="Directory in which the four example PDFs will be written.",
        )

    def handle(self, *args, **options):
        output_dir = Path(options["output_dir"]).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        now = timezone.now()

        offer_values = {
            "offer_date": date(2026, 8, 20),
            "expiry_date": date(2026, 8, 27),
            "candidate_full_name": "مريم عبد الرحمن Mariam Abdelrahman",
            "nationality": "Egyptian / مصرية",
            "id_passport_iqama_number": "A12345678",
            "position_title": "Senior Project Controls Engineer",
            "classification": "Professional",
            "department": "Project Management Office",
            "location": "New Administrative Capital, Cairo",
            "basic_salary": Decimal("25000.00"),
            "housing_allowance": Decimal("6250.00"),
            "transportation_allowance": Decimal("2500.00"),
            "other_allowance": Decimal("1250.00"),
            "total_salary_package": Decimal("35000.00"),
            "vacation": "30 calendar days",
            "tickets": "Annual return ticket",
            "contract_status": "New",
            "contract_type": "Fixed term",
            "contract_duration": "2 years",
            "medical_insurance": "Class A",
            "hr_signer_name": "Nour Hassan",
            "hr_signer_title": "Human Resources Manager",
        }
        accepted_offer = JobOffer(
            **offer_values,
            reference_number="JO-2026-EXAMPLE-ACCEPTED",
            status=JobOffer.Status.ACCEPTED,
            accepted_at=now,
        )
        rejected_offer = JobOffer(
            **offer_values,
            reference_number="JO-2026-EXAMPLE-REJECTED",
            status=JobOffer.Status.REJECTED,
            rejected_at=now,
            rejection_reason=(
                "I cannot accept because the proposed start date conflicts with my current contractual notice period."
            ),
        )

        employee = EmployeeProfile(
            employee_id="EMP-2026-014",
            full_name="مريم عبد الرحمن",
            full_name_en="Mariam Abdelrahman",
            national_id="29801011234567",
            job_title="Senior Project Controls Engineer",
            department="Project Management Office",
            hire_date=date(2026, 8, 23),
        )
        started_data = StartingWorkAcknowledgmentData(
            reference_no="SWA-2026-EXAMPLE-STARTED",
            document_date=date(2026, 8, 20),
            addressed_to="Human Resources Department / إدارة الموارد البشرية",
            direct_superior="Ahmed Mostafa",
            direct_superior_signature="Approved electronically",
            work_start_status="started",
            start_date=date(2026, 8, 23),
            general_manager_name="Omar Khaled",
            general_manager_date=date(2026, 8, 20),
            details_approver_name="Nour Hassan",
            details_approver_date=date(2026, 8, 20),
        )
        not_started_data = StartingWorkAcknowledgmentData(
            reference_no="SWA-2026-EXAMPLE-NOT-STARTED",
            document_date=date(2026, 8, 20),
            addressed_to="Human Resources Department / إدارة الموارد البشرية",
            direct_superior="Ahmed Mostafa",
            work_start_status="not_started",
            not_started_reason=(
                "لم يباشر الموظف العمل لطلب تعديل تاريخ الانضمام حتى استكمال فترة الإشعار التعاقدية الحالية."
            ),
            not_started_name="Nour Hassan",
            not_started_date=date(2026, 8, 20),
        )

        examples = {
            "job_offer_accepted_example.pdf": build_job_offer_pdf(accepted_offer),
            "job_offer_rejected_example.pdf": build_job_offer_pdf(rejected_offer),
            "starting_work_started_example.pdf": build_starting_work_acknowledgment_pdf(employee, started_data),
            "starting_work_not_started_example.pdf": build_starting_work_acknowledgment_pdf(employee, not_started_data),
        }
        for filename, content in examples.items():
            destination = output_dir / filename
            destination.write_bytes(content)
            self.stdout.write(self.style.SUCCESS(str(destination)))
