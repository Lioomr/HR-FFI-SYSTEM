from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from pypdf import PdfReader

from core.pdf_forms import SIGNATURE_MISSING, SIGNATURE_PLACED, SignatureAsset, render_mapped_form
from core.tests_pdf_forms import image_boxes, make_png
from employees.models import EmployeeProfile

from ..models import JobOffer
from ..pdf import _load_form_assets, build_job_offer_pdf, build_job_offer_signers
from ..services import generate_starting_work_acknowledgment_for_employee
from ..starting_work_pdf import (
    StartingWorkAcknowledgmentData,
    build_starting_work_acknowledgment_pdf,
    build_starting_work_signers,
    load_starting_work_form_assets,
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

    def test_each_template_is_paired_with_the_map_beside_it(self):
        """Template and map must resolve together from one directory."""

        offer_assets = _load_form_assets()
        starting_assets = load_starting_work_form_assets()

        for assets, map_name in (
            (offer_assets, "job_offer_blank_field_map.json"),
            (starting_assets, "starting_work_acknowledgment_blank_field_map.json"),
        ):
            self.assertIsNotNone(assets)
            self.assertTrue((Path(assets.template_path).parent / map_name).exists())

    def test_template_without_its_map_falls_back_instead_of_guessing(self):
        source = Path(settings.BASE_DIR) / "static" / "pdf_templates" / "job_offer_blank.pdf"
        with TemporaryDirectory() as template_dir:
            Path(template_dir, "job_offer_blank.pdf").write_bytes(source.read_bytes())
            with override_settings(HR_TEMPLATES_DIR=template_dir):
                self.assertIsNone(_load_form_assets())

    def test_job_offer_signers_use_the_recorded_hr_signer_only(self):
        offer = self.offer()
        hr_user = get_user_model()(full_name="Nour Hassan", email="nour@ffi.test")
        offer.hr_signer_user = hr_user

        signers = build_job_offer_signers(offer)

        self.assertIs(signers["hr_signature_image"], hr_user)
        # A candidate is external and has no stored signature to place.
        self.assertIsNone(signers["applicant_signature"])

    def test_offer_without_a_recorded_hr_signer_has_no_signer(self):
        signers = build_job_offer_signers(self.offer())

        self.assertIsNone(signers["hr_signature_image"])
        self.assertIsNone(signers["applicant_signature"])

    def test_candidate_signature_box_stays_empty(self):
        assets = _load_form_assets()
        pdf_bytes, diagnostics = render_mapped_form(
            assets,
            {"reference_no": "JO-2026-014"},
            signatures=build_job_offer_signers(self.offer()) | {"hr_signature_image": None},
        )

        self.assertEqual(image_boxes(pdf_bytes), [])
        states = {row["field"]: row["state"] for row in diagnostics}
        self.assertEqual(states["applicant_signature"], SIGNATURE_MISSING)

    def test_starting_work_signature_lands_only_in_its_mapped_box(self):
        assets = load_starting_work_form_assets()
        spec = assets.fields["details_approver_signature_image"]

        pdf_bytes, diagnostics = render_mapped_form(
            assets,
            starting_work_field_values(
                self.employee(),
                StartingWorkAcknowledgmentData(reference_no="SWA-SIG-001", start_date=date(2026, 8, 23)),
            ),
            signatures={
                "details_approver_signature_image": SignatureAsset(data=make_png(), signer_label="Nour Hassan"),
                "general_manager_signature_image": None,
            },
        )

        boxes = image_boxes(pdf_bytes)
        self.assertEqual(len(boxes), 1)
        x0, y0, x1, y1 = boxes[0]
        self.assertGreaterEqual(x0, spec["x"])
        self.assertLessEqual(x1, spec["x"] + spec["width"])
        self.assertGreaterEqual(y0, spec["y"])
        self.assertLessEqual(y1, spec["y"] + spec["height"])
        states = {row["field"]: row["state"] for row in diagnostics}
        self.assertEqual(states["details_approver_signature_image"], SIGNATURE_PLACED)
        self.assertEqual(states["general_manager_signature_image"], SIGNATURE_MISSING)

    def test_starting_work_signers_come_from_the_recorded_actors(self):
        approver = SimpleNamespace(full_name="Nour Hassan", email="nour@ffi.test")
        data = StartingWorkAcknowledgmentData(details_approver_user=approver, not_started_user=approver)

        signers = build_starting_work_signers(data)

        self.assertIs(signers["details_approver_signature_image"], approver)
        # The "not started" block is not in play while the employee has started.
        self.assertIsNone(signers["not_started_signature"])

    def test_generated_acknowledgment_has_no_signature_when_none_is_stored(self):
        pdf_bytes = generate_starting_work_acknowledgment_for_employee(
            self.employee(),
            data=StartingWorkAcknowledgmentData(reference_no="SWA-NOSIG-001", start_date=date(2026, 8, 23)),
        )

        self.assertEqual(image_boxes(pdf_bytes), [])

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

    def test_job_offer_pdf_uses_the_production_template_when_it_is_available(self):
        pdf_bytes = build_job_offer_pdf(self.offer())
        extracted = PdfReader(BytesIO(pdf_bytes)).pages[0].extract_text()

        self.assertIn("Applicant Details", extracted)
        self.assertIn("Monthly Salary Details", extracted)
        self.assertIn("Benefits / Contract Details", extracted)

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

    @patch("core.pdf_forms.resolve_template_path", return_value="")
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
