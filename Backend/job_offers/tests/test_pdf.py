from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase
from django.utils import timezone
from pypdf import PdfReader

from employees.models import EmployeeProfile

from ..document_pdf import load_document_field_map
from ..models import JobOffer
from ..pdf import build_job_offer_pdf
from ..services import generate_starting_work_acknowledgment_for_employee
from ..starting_work_pdf import (
    StartingWorkAcknowledgmentData,
    build_starting_work_acknowledgment_pdf,
    starting_work_field_values,
)


class HrDocumentPdfTests(SimpleTestCase):
    def employee(self) -> EmployeeProfile:
        return EmployeeProfile(
            employee_id="EMP-2026-014",
            full_name="مريم عبد الرحمن",
            full_name_en="Mariam Abdelrahman",
            national_id="29801011234567",
            job_title="Senior Project Controls Engineer",
            department="Project Management Office",
            hire_date=date(2026, 8, 23),
        )

    def offer(self) -> JobOffer:
        return JobOffer(
            reference_number="JO-2026-014",
            offer_date=date(2026, 8, 20),
            expiry_date=date(2026, 8, 27),
            candidate_full_name="مريم عبد الرحمن Mariam Abdelrahman",
            nationality="Egyptian",
            id_passport_iqama_number="A12345678",
            position_title="Senior Project Controls Engineer",
            classification="Professional",
            department="Project Management Office",
            location="New Administrative Capital, Cairo",
            basic_salary=Decimal("25000.00"),
            housing_allowance=Decimal("6250.00"),
            transportation_allowance=Decimal("2500.00"),
            other_allowance=Decimal("1250.00"),
            total_salary_package=Decimal("35000.00"),
            vacation="30 calendar days",
            tickets="Annual return ticket",
            contract_status="New",
            contract_type="Fixed term",
            contract_duration="2 years",
            medical_insurance="Class A",
            hr_signer_name="Nour Hassan",
            hr_signer_title="Human Resources Manager",
            status=JobOffer.Status.REJECTED,
            rejection_reason=(
                "I cannot accept because the proposed start date conflicts with an existing notice period."
            ),
            rejected_at=timezone.now(),
        )

    def test_combined_map_is_the_authoritative_source_for_both_documents(self):
        offer_fields = load_document_field_map("job_offer", "job_offer_blank_field_map.json")
        starting_fields = load_document_field_map(
            "starting_work_acknowledgment", "starting_work_acknowledgment_blank_field_map.json"
        )

        self.assertEqual(len(offer_fields), 29)
        self.assertEqual(len(starting_fields), 25)
        self.assertTrue(offer_fields["rejection_reason"]["multiline"])
        self.assertTrue(starting_fields["not_started_reason"]["multiline"])

    def test_job_offer_pdf_is_single_page_and_contains_overlay_values(self):
        pdf_bytes = build_job_offer_pdf(self.offer())
        reader = PdfReader(BytesIO(pdf_bytes))
        extracted = reader.pages[0].extract_text()

        self.assertEqual(len(reader.pages), 1)
        self.assertIn("JO-2026-014", extracted)
        self.assertIn("Senior Project Controls Engineer", extracted)
        self.assertIn("existing", extracted)
        self.assertIn("notice", extracted)
        self.assertIn("period.", extracted)

    def test_starting_work_pdf_started_state_uses_profile_and_start_date(self):
        profile = self.employee()
        data = StartingWorkAcknowledgmentData(
            reference_no="SWA-2026-014",
            document_date=date(2026, 8, 20),
            addressed_to="Human Resources Department",
            direct_superior="Ahmed Mostafa",
            start_date=date(2026, 8, 23),
            general_manager_name="Omar Khaled",
            general_manager_date=date(2026, 8, 20),
            details_approver_name="Nour Hassan",
            details_approver_date=date(2026, 8, 20),
        )
        values = starting_work_field_values(profile, data)
        pdf_bytes = generate_starting_work_acknowledgment_for_employee(profile, data=data)
        reader = PdfReader(BytesIO(pdf_bytes))
        extracted = reader.pages[0].extract_text()

        self.assertEqual((values["start_day"], values["start_month"], values["start_year"]), ("23", "08", "2026"))
        self.assertEqual(values["not_started_reason"], "")
        self.assertEqual(len(reader.pages), 1)
        self.assertIn("SWA-2026-014", extracted)
        self.assertIn("Ahmed Mostafa", extracted)

    def test_starting_work_pdf_not_started_state_wraps_reason_and_omits_start_date(self):
        profile = self.employee()
        data = StartingWorkAcknowledgmentData(
            reference_no="SWA-2026-015",
            work_start_status="not_started",
            not_started_reason=(
                "The employee requested a revised joining date while completing the contractual notice period."
            ),
            not_started_name="Nour Hassan",
            not_started_date=date(2026, 8, 20),
        )
        values = starting_work_field_values(profile, data)
        pdf_bytes = generate_starting_work_acknowledgment_for_employee(profile, data=data)
        reader = PdfReader(BytesIO(pdf_bytes))
        extracted = reader.pages[0].extract_text()

        self.assertEqual(values["start_day"], "")
        self.assertIn("revised joining date", values["not_started_reason"])
        self.assertEqual(len(reader.pages), 1)
        self.assertIn("SWA-2026-015", extracted)
        self.assertIn("revised joining date", extracted)

    def test_starting_work_status_rejects_unknown_value(self):
        with self.assertRaisesMessage(ValueError, "work_start_status"):
            starting_work_field_values(self.employee(), StartingWorkAcknowledgmentData(work_start_status="pending"))

    @patch("job_offers.starting_work_pdf.resolve_template_path", return_value=None)
    def test_starting_work_pdf_fallback_remains_available(self, _resolve_template_path):
        pdf_bytes = build_starting_work_acknowledgment_pdf(
            self.employee(),
            StartingWorkAcknowledgmentData(
                reference_no="SWA-FALLBACK-001",
                start_date=date(2026, 8, 23),
            ),
        )
        reader = PdfReader(BytesIO(pdf_bytes))

        self.assertEqual(len(reader.pages), 1)
        self.assertIn("SWA-FALLBACK-001", reader.pages[0].extract_text())

    def test_example_command_generates_all_four_single_page_pdfs(self):
        with TemporaryDirectory() as output_dir:
            call_command("generate_hr_document_examples", output_dir=output_dir, verbosity=0)
            examples = sorted(Path(output_dir).glob("*.pdf"))

            self.assertEqual(len(examples), 4)
            for example in examples:
                self.assertEqual(len(PdfReader(str(example)).pages), 1)
