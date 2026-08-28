from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import FieldDoesNotExist
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from pypdf import PdfReader
from rest_framework import status
from rest_framework.test import APITestCase

from attendance.models import BioTimeEmployeeMap
from audit.models import AuditLog
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from invites.models import Invite
from organization.models import OrganizationNode, UserOrganizationAccess

from ..models import HiringRequest, JobOffer
from ..notifications import notify_job_offer_biotime_mapping_missing
from ..pdf import build_job_offer_pdf
from ..services import deliver_job_offer, ensure_prehire_profile_for_offer

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class JobOfferApiTests(APITestCase):
    def setUp(self):
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company = OrganizationNode.objects.create(
            code="FFI", name="Job Offer Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="JO-OTHER", name="Other Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.department = Department.objects.create(company=self.company, code="PRJ", name="Projects")
        self.engineering_department = Department.objects.create(
            company=self.company, code="ENG-DEPT", name="Engineering"
        )
        self.position = Position.objects.create(company=self.company, code="ENG", name="Project Engineer")
        self.other_department = Department.objects.create(
            company=self.other_company, code="OTH", name="Other Department"
        )
        self.other_position = Position.objects.create(company=self.other_company, code="OTH", name="Other Position")
        self.hr = User.objects.create_user(
            email="job-offer-hr@example.com",
            password="StrongPass123!",
            full_name="Nour Hassan",
        )
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.hr_profile = EmployeeProfile.objects.create(
            user=self.hr,
            company=self.company,
            employee_id="JO-HR-1",
            full_name="Nour Hassan",
            job_title="HR Business Partner",
        )
        self.employee_user = User.objects.create_user(email="ordinary@example.com", password="StrongPass123!")
        self.employee_user.groups.add(employee_group)
        EmployeeProfile.objects.create(
            user=self.employee_user,
            company=self.company,
            employee_id="JO-EMP-1",
            full_name="Ordinary Employee",
        )
        self.prehire = EmployeeProfile.objects.create(
            company=self.company,
            employee_id="JO-PRE-1",
            full_name="Candidate One",
            employment_status=EmployeeProfile.EmploymentStatus.PREHIRE,
        )
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

    def payload(self, **overrides):
        hiring_request_id = overrides.pop("hiring_request_id", None)
        if hiring_request_id is None:
            sequence = HiringRequest.objects.count() + 1
            hiring_request = HiringRequest.objects.create(
                company=self.company,
                reference_number=f"HRQ-FFI-{timezone.localdate().year}-{sequence:04d}",
                candidate_full_name=overrides.get("candidate_full_name", "Candidate One"),
                candidate_email=overrides.get("candidate_email", "candidate.one@example.com"),
                candidate_phone_number=overrides.get("candidate_phone_number", "+201001234567"),
                nationality=overrides.get("nationality", "Egyptian"),
                date_of_birth=overrides.get("date_of_birth", "1994-05-17"),
                proposed_salary=Decimal(overrides.get("basic_salary", "10000.00")),
                cv_file=SimpleUploadedFile("candidate.pdf", b"%PDF-1.4\n%%EOF", content_type="application/pdf"),
                status=HiringRequest.Status.APPROVED,
                requested_by=self.hr,
                ceo_decision_by=self.hr,
                ceo_decision_at=timezone.now(),
                created_by=self.hr,
                updated_by=self.hr,
            )
            hiring_request_id = hiring_request.id
        data = {
            "hiring_request_id": hiring_request_id,
            "department_id": self.department.id,
            "position_id": self.position.id,
            "candidate_full_name": "Candidate One",
            "candidate_email": "candidate.one@example.com",
            "candidate_phone_number": "+201001234567",
            "nationality": "Egyptian",
            "id_passport_iqama_number": "A1234567",
            "position_title": "Project Engineer",
            "classification": "Technical",
            "department": "Projects",
            "location": "Riyadh",
            "basic_salary": "10000.00",
            "housing_allowance": "2500.00",
            "transportation_allowance": "1000.00",
            "other_allowance": "500.00",
            "total_salary_package": "14000.00",
            "vacation": "30 calendar days",
            "tickets": "Annual return ticket",
            "contract_status": "New",
            "contract_type": "Fixed term",
            "contract_duration": "2 years",
            "medical_insurance": "Class A",
            "offer_date": timezone.localdate().isoformat(),
            "expiry_date": (timezone.localdate() + timedelta(days=7)).isoformat(),
        }
        data.update(overrides)
        return data

    def create_offer(self, **overrides):
        return JobOffer.objects.create(
            company=self.company,
            employee_profile=self.prehire,
            created_by=self.hr,
            updated_by=self.hr,
            hr_signer_user=self.hr,
            hr_signer_name=self.hr.full_name,
            hr_signer_title=self.hr_profile.job_title,
            candidate_full_name=overrides.pop("candidate_full_name", "Candidate One"),
            candidate_email=overrides.pop("candidate_email", "candidate.one@example.com"),
            candidate_phone_number=overrides.pop("candidate_phone_number", "+201001234567"),
            nationality="Egyptian",
            id_passport_iqama_number="A1234567",
            position_title="Project Engineer",
            department="Projects",
            department_ref=overrides.pop("department_ref", None),
            position_ref=overrides.pop("position_ref", None),
            location="Riyadh",
            basic_salary=Decimal("10000.00"),
            housing_allowance=Decimal("2500.00"),
            transportation_allowance=Decimal("1000.00"),
            other_allowance=Decimal("500.00"),
            total_salary_package=Decimal("14000.00"),
            offer_date=timezone.localdate(),
            expiry_date=overrides.pop("expiry_date", timezone.localdate() + timedelta(days=7)),
            reference_number=overrides.pop("reference_number", f"JO-{JobOffer.objects.count() + 1}"),
            **overrides,
        )

    def authenticate_hr(self):
        self.client.force_authenticate(self.hr)

    def send_offer(self, offer):
        offer.status = JobOffer.Status.SENT
        offer.response_token = JobOffer.generate_response_token()
        offer.sent_at = timezone.now()
        offer.save(update_fields=["status", "response_token", "sent_at", "updated_at"])
        return offer

    def test_hr_can_create_and_update_draft_job_offer(self):
        self.authenticate_hr()
        response = self.client.post("/job-offers/", self.payload(), format="json", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        offer = JobOffer.objects.get()
        self.assertEqual(offer.company, self.company)
        self.assertEqual(offer.status, JobOffer.Status.DRAFT)
        self.assertRegex(offer.reference_number, rf"^JO-FFI-{timezone.localdate().year}-0001$")
        self.assertEqual(offer.hr_signer_user, self.hr)
        self.assertEqual(offer.hr_signer_name, "Nour Hassan")
        self.assertEqual(offer.hr_signer_title, "HR Business Partner")
        self.assertIsNotNone(offer.employee_profile_id)
        self.assertNotEqual(offer.employee_profile_id, self.prehire.id)
        self.assertEqual(response.data["data"]["employee_profile_id"], offer.employee_profile_id)
        self.assertEqual(response.data["data"]["department_id"], self.department.id)
        self.assertEqual(response.data["data"]["position_id"], self.position.id)
        self.assertEqual(response.data["data"]["biotime"]["is_mapped"], False)
        linked_profile = offer.employee_profile
        self.assertEqual(linked_profile.employment_status, EmployeeProfile.EmploymentStatus.PREHIRE)
        self.assertEqual(linked_profile.company, self.company)
        self.assertEqual(linked_profile.full_name, "Candidate One")
        self.assertEqual(linked_profile.mobile, "+201001234567")
        self.assertEqual(linked_profile.date_of_birth.isoformat(), "1994-05-17")
        self.assertEqual(linked_profile.department_ref, self.department)
        self.assertEqual(linked_profile.position_ref, self.position)
        self.assertFalse(response.data["data"]["has_response_token"])
        self.assertNotIn("grade", response.data["data"])
        self.assertNotIn("response_token", response.data["data"])
        created_audit = AuditLog.objects.get(action="job_offer_created", entity_id=str(offer.id))
        self.assertEqual(created_audit.metadata["reference_number"], offer.reference_number)
        self.assertEqual(created_audit.metadata["hr_signer_user_id"], self.hr.id)
        self.assertEqual(created_audit.metadata["hr_signer_name"], "Nour Hassan")

        updated = self.client.patch(
            f"/job-offers/{offer.id}/",
            {
                "department_id": self.engineering_department.id,
                "reference_number": "CLIENT-OVERRIDE",
                "hr_signer_user_id": self.employee_user.id,
                "hr_signer_name": "Client Signer",
                "hr_signer_title": "Client Title",
            },
            format="json",
            **self.headers,
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        offer.refresh_from_db()
        self.assertEqual(offer.department, "Engineering")
        self.assertEqual(offer.department_ref, self.engineering_department)
        self.assertNotEqual(offer.reference_number, "CLIENT-OVERRIDE")
        self.assertEqual(offer.hr_signer_user, self.hr)
        self.assertEqual(offer.hr_signer_name, "Nour Hassan")
        self.assertEqual(offer.hr_signer_title, "HR Business Partner")
        self.assertTrue(AuditLog.objects.filter(action="job_offer_updated", entity_id=str(offer.id)).exists())
        linked_profile.refresh_from_db()
        self.assertEqual(linked_profile.department_ref, self.engineering_department)

    def test_linked_offer_profile_ensure_is_idempotent(self):
        self.authenticate_hr()
        response = self.client.post("/job-offers/", self.payload(), format="json", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        offer = JobOffer.objects.get()
        profile_count = EmployeeProfile.objects.count()

        profile, created = ensure_prehire_profile_for_offer(offer)

        self.assertFalse(created)
        self.assertEqual(profile.id, offer.employee_profile_id)
        self.assertEqual(EmployeeProfile.objects.count(), profile_count)

    def test_reference_numbers_are_unique_and_client_values_are_ignored(self):
        self.authenticate_hr()
        first = self.client.post(
            "/job-offers/",
            self.payload(
                reference_number="CLIENT-ONE",
                hr_signer_name="Client Signer",
                hr_signer_title="Client Title",
            ),
            format="json",
            **self.headers,
        )
        second = self.client.post(
            "/job-offers/",
            self.payload(reference_number="CLIENT-TWO"),
            format="json",
            **self.headers,
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.data)
        first_offer, second_offer = JobOffer.objects.order_by("id")
        year = timezone.localdate().year
        self.assertEqual(first_offer.reference_number, f"JO-FFI-{year}-0001")
        self.assertEqual(second_offer.reference_number, f"JO-FFI-{year}-0002")
        self.assertNotEqual(first_offer.reference_number, second_offer.reference_number)
        self.assertEqual(first_offer.hr_signer_name, "Nour Hassan")
        self.assertEqual(first_offer.hr_signer_title, "HR Business Partner")

    def test_job_offer_database_and_model_have_no_grade_field(self):
        with self.assertRaises(FieldDoesNotExist):
            JobOffer._meta.get_field("grade")
        with connection.cursor() as cursor:
            columns = connection.introspection.get_table_description(cursor, JobOffer._meta.db_table)
        self.assertNotIn("grade", {column.name for column in columns})

    def test_non_hr_cannot_create_or_list_internal_offers(self):
        self.client.force_authenticate(self.employee_user)
        create = self.client.post("/job-offers/", self.payload(), format="json", **self.headers)
        listing = self.client.get("/job-offers/", **self.headers)
        self.assertEqual(create.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(listing.status_code, status.HTTP_403_FORBIDDEN)

    def test_company_scope_hides_cross_company_offers_and_profiles(self):
        foreign = JobOffer.objects.create(
            company=self.other_company,
            created_by=self.hr,
            updated_by=self.hr,
            hr_signer_user=self.hr,
            hr_signer_name=self.hr.full_name,
            hr_signer_title=self.hr_profile.job_title,
            candidate_full_name="Foreign Candidate",
            position_title="Engineer",
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number="FOREIGN-1",
        )
        foreign_profile = EmployeeProfile.objects.create(
            company=self.other_company, employee_id="JO-FOREIGN", full_name="Foreign Profile"
        )
        self.authenticate_hr()
        listing = self.client.get("/job-offers/", **self.headers)
        detail = self.client.get(f"/job-offers/{foreign.id}/", **self.headers)
        create = self.client.post(
            "/job-offers/", self.payload(employee_profile_id=foreign_profile.id), format="json", **self.headers
        )
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertNotIn("Foreign Candidate", str(listing.data))
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)
        self.assertNotEqual(create.data["data"]["employee_profile_id"], foreign_profile.id)

    def test_department_and_position_must_be_active_same_company_references(self):
        inactive_department = Department.objects.create(
            company=self.company, code="OLD", name="Inactive", is_active=False
        )
        self.authenticate_hr()

        cross_company = self.client.post(
            "/job-offers/",
            self.payload(department_id=self.other_department.id, position_id=self.other_position.id),
            format="json",
            **self.headers,
        )
        inactive = self.client.post(
            "/job-offers/",
            self.payload(department_id=inactive_department.id),
            format="json",
            **self.headers,
        )

        self.assertEqual(cross_company.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(inactive.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        cross_fields = {item["field"] for item in cross_company.data["errors"]}
        inactive_fields = {item["field"] for item in inactive.data["errors"]}
        self.assertEqual(cross_fields, {"department_id", "position_id"})
        self.assertEqual(inactive_fields, {"department_id"})

    @patch("job_offers.views.deliver_job_offer")
    def test_hr_can_send_offer_only_once(self, deliver):
        deliver.return_value = {
            "channels": {"whatsapp": {"sent": True, "provider": "evolution_whatsapp"}},
            "warnings": [],
        }
        offer = self.create_offer()
        offer.hr_signer_user = self.employee_user
        offer.hr_signer_name = "Manual Override"
        offer.hr_signer_title = "Manual Title"
        offer.save(update_fields=["hr_signer_user", "hr_signer_name", "hr_signer_title", "updated_at"])
        self.authenticate_hr()
        first = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(first.status_code, status.HTTP_200_OK, first.data)
        offer.refresh_from_db()
        token = offer.response_token
        self.assertEqual(offer.status, JobOffer.Status.SENT)
        self.assertTrue(token)
        self.assertEqual(offer.hr_signer_user, self.hr)
        self.assertEqual(offer.hr_signer_name, "Nour Hassan")
        self.assertEqual(offer.hr_signer_title, "HR Business Partner")

        second = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.data["message"], "This job offer has already been sent.")
        offer.refresh_from_db()
        self.assertEqual(offer.response_token, token)
        deliver.assert_called_once_with(offer)
        sent_audit = AuditLog.objects.get(action="job_offer_sent", entity_id=str(offer.id))
        self.assertEqual(sent_audit.metadata["reference_number"], offer.reference_number)
        self.assertEqual(sent_audit.metadata["hr_signer_user_id"], self.hr.id)
        self.assertEqual(sent_audit.metadata["hr_signer_name"], "Nour Hassan")

    def test_pdf_endpoint_returns_pdf_and_audits_download(self):
        offer = self.create_offer()
        self.authenticate_hr()
        response = self.client.get(f"/job-offers/{offer.id}/pdf/", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        self.assertIn("attachment", response["Content-Disposition"].lower())
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertTrue(response.content.startswith(b"%PDF"))
        self.assertTrue(AuditLog.objects.filter(action="job_offer_pdf_downloaded", entity_id=str(offer.id)).exists())

    def test_pdf_uses_generated_reference_and_automatic_signer(self):
        self.authenticate_hr()
        response = self.client.post("/job-offers/", self.payload(), format="json", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        offer = JobOffer.objects.get()
        extracted = PdfReader(BytesIO(build_job_offer_pdf(offer))).pages[0].extract_text()

        self.assertIn(offer.reference_number, extracted)
        self.assertIn("Nour Hassan", extracted)
        self.assertIn("HR Business Partner", extracted)

    @patch("job_offers.pdf.resolve_template_path", return_value="")
    def test_pdf_renderer_has_missing_template_fallback(self, _resolve_template):
        pdf_bytes = build_job_offer_pdf(self.create_offer())
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))

    @patch("job_offers.services.EmailService")
    def test_email_delivery_uploads_and_attaches_job_offer_pdf(self, email_service_class):
        email_service = email_service_class.return_value
        email_service.upload_media.return_value = {"success": True, "media_url": "https://media.example/offer.pdf"}
        email_service.send_html_email.return_value = {
            "success": True,
            "provider": "bird",
            "message_id": "email-offer-1",
            "status_code": 202,
        }
        offer = self.create_offer(candidate_phone_number="", response_token=JobOffer.generate_response_token())
        metadata = deliver_job_offer(offer)
        attachments = email_service.send_html_email.call_args.kwargs["attachments"]
        self.assertEqual(attachments[0]["mediaUrl"], "https://media.example/offer.pdf")
        self.assertEqual(metadata["channels"]["email"]["attachment"], "attached")
        self.assertEqual(metadata["warnings"], [])

    def test_public_get_returns_only_safe_summary(self):
        offer = self.send_offer(self.create_offer(department_ref=self.department, position_ref=self.position))
        response = self.client.get("/job-offers/respond/", {"token": offer.response_token})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["candidate_full_name"], offer.candidate_full_name)
        self.assertTrue(response.data["data"]["can_respond"])
        self.assertNotIn("candidate_email", response.data["data"])
        self.assertNotIn("id_passport_iqama_number", response.data["data"])
        self.assertNotIn("response_token", response.data["data"])

    def test_public_get_invalid_and_expired_tokens_fail_safely(self):
        invalid = self.client.get("/job-offers/respond/", {"token": "not-valid"})
        expired_offer = self.send_offer(self.create_offer(expiry_date=timezone.localdate() - timedelta(days=1)))
        expired = self.client.get("/job-offers/respond/", {"token": expired_offer.response_token})
        self.assertEqual(invalid.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(expired.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        expired_offer.refresh_from_db()
        self.assertEqual(expired_offer.status, JobOffer.Status.EXPIRED)

    @patch("job_offers.views.notify_job_offer_biotime_mapping_missing")
    @patch("job_offers.services.send_user_invite_whatsapp")
    def test_accept_updates_prehire_and_creates_whatsapp_invite_once(self, send_invite, notify_missing):
        notify_missing.return_value = [{"recipient_id": self.hr.id, "in_app_created": True}]
        send_invite.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-invite-1",
            "status_code": 201,
        }
        offer = self.send_offer(self.create_offer(department_ref=self.department, position_ref=self.position))
        response = self.client.post(
            "/job-offers/respond/",
            {"token": offer.response_token, "decision": "accepted"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        offer.refresh_from_db()
        self.prehire.refresh_from_db()
        self.assertEqual(offer.status, JobOffer.Status.ACCEPTED)
        self.assertEqual(self.prehire.job_title, offer.position_title)
        self.assertEqual(self.prehire.total_salary, offer.total_salary_package)
        self.assertEqual(self.prehire.department_ref, self.department)
        self.assertEqual(self.prehire.position_ref, self.position)
        invite = Invite.objects.get(id=offer.account_invite_id)
        self.assertEqual(invite.channel, Invite.Channel.WHATSAPP)
        self.assertEqual(invite.employee_profile, self.prehire)
        self.assertEqual(response.data["data"]["employee_profile_id"], self.prehire.id)
        self.assertEqual(
            response.data["data"]["biotime"],
            {"is_mapped": False, "biotime_emp_code": None, "mapping_id": None},
        )
        notify_missing.assert_called_once_with(offer)
        self.assertTrue(AuditLog.objects.filter(action="job_offer_accepted", entity_id=str(offer.id)).exists())
        self.assertTrue(
            AuditLog.objects.filter(action="job_offer_accepted_profile_updated", entity_id=str(offer.id)).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="job_offer_biotime_mapping_missing_notified", entity_id=str(offer.id)
            ).exists()
        )
        self.assertTrue(AuditLog.objects.filter(action="job_offer_invitation_sent", entity_id=str(offer.id)).exists())

        repeated = self.client.post(
            "/job-offers/respond/",
            {"token": offer.response_token, "decision": "accepted"},
            format="json",
        )
        self.assertEqual(repeated.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Invite.objects.filter(job_offers=offer).count(), 1)

    @patch("job_offers.notifications.dispatch_notification_channels")
    def test_missing_biotime_notification_targets_company_hr_channels(self, dispatch):
        dispatch.return_value = {
            "notification": object(),
            "whatsapp": {"status": "pending"},
            "email": None,
        }
        offer = self.create_offer()

        results = notify_job_offer_biotime_mapping_missing(offer)

        self.assertEqual([result["recipient_id"] for result in results], [self.hr.id])
        dispatch.assert_called_once()
        call = dispatch.call_args.kwargs
        self.assertEqual(call["recipient"], self.hr)
        self.assertEqual(call["company"], self.company)
        self.assertTrue(call["whatsapp_enabled"])
        self.assertTrue(call["email_enabled"])
        self.assertNotIn("token", call["metadata"])

    @patch("job_offers.views.notify_job_offer_biotime_mapping_missing", return_value=[])
    @patch("job_offers.services.send_user_invite_email")
    def test_email_only_accept_creates_email_invite(self, send_invite, _notify_missing):
        send_invite.return_value = {"success": True, "provider": "bird", "message_id": "email-invite-1"}
        offer = self.send_offer(self.create_offer(candidate_phone_number=""))
        response = self.client.post(
            "/job-offers/respond/",
            {"token": offer.response_token, "decision": "accepted"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invite = Invite.objects.get(job_offers=offer)
        self.assertEqual(invite.channel, Invite.Channel.EMAIL)
        send_invite.assert_called_once()

    @patch("job_offers.views.notify_job_offer_biotime_mapping_missing")
    @patch("job_offers.services.send_user_invite_whatsapp")
    def test_existing_biotime_mapping_is_returned_without_missing_notification(self, send_invite, notify_missing):
        send_invite.return_value = {"success": True, "provider": "evolution_whatsapp"}
        mapping = BioTimeEmployeeMap.objects.create(employee_profile=self.prehire, biotime_emp_code="100001")
        offer = self.send_offer(self.create_offer())

        response = self.client.post(
            "/job-offers/respond/",
            {"token": offer.response_token, "decision": "accepted"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(
            response.data["data"]["biotime"],
            {"is_mapped": True, "biotime_emp_code": "100001", "mapping_id": mapping.id},
        )
        notify_missing.assert_not_called()
        self.assertTrue(
            AuditLog.objects.filter(action="job_offer_biotime_mapping_present", entity_id=str(offer.id)).exists()
        )

    def test_reject_stores_reason_and_does_not_create_invite(self):
        offer = self.send_offer(self.create_offer())
        response = self.client.post(
            "/job-offers/respond/",
            {"token": offer.response_token, "decision": "rejected", "reason": "Accepted another role"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        offer.refresh_from_db()
        self.assertEqual(offer.status, JobOffer.Status.REJECTED)
        self.assertEqual(offer.rejection_reason, "Accepted another role")
        self.assertEqual(Invite.objects.count(), 0)
        self.assertTrue(AuditLog.objects.filter(action="job_offer_rejected", entity_id=str(offer.id)).exists())

    def test_cancelled_and_expired_offers_cannot_be_accepted(self):
        cancelled = self.send_offer(self.create_offer())
        cancelled.status = JobOffer.Status.CANCELLED
        cancelled.cancelled_at = timezone.now()
        cancelled.save(update_fields=["status", "cancelled_at", "updated_at"])
        expired = self.send_offer(self.create_offer(expiry_date=timezone.localdate() - timedelta(days=1)))
        cancelled_response = self.client.post(
            "/job-offers/respond/",
            {"token": cancelled.response_token, "decision": "accepted"},
            format="json",
        )
        expired_response = self.client.post(
            "/job-offers/respond/",
            {"token": expired.response_token, "decision": "accepted"},
            format="json",
        )
        self.assertEqual(cancelled_response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(expired_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(Invite.objects.count(), 0)

    def test_hr_can_cancel_offer_and_action_is_audited(self):
        offer = self.create_offer()
        self.authenticate_hr()
        response = self.client.post(f"/job-offers/{offer.id}/cancel/", {}, format="json", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        offer.refresh_from_db()
        self.assertEqual(offer.status, JobOffer.Status.CANCELLED)
        self.assertIsNotNone(offer.cancelled_at)
        self.assertTrue(AuditLog.objects.filter(action="job_offer_cancelled", entity_id=str(offer.id)).exists())

    @patch("job_offers.views.deliver_job_offer")
    def test_delivery_failure_does_not_roll_back_send(self, deliver):
        deliver.side_effect = RuntimeError("provider unavailable")
        offer = self.create_offer()
        self.authenticate_hr()
        response = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        offer.refresh_from_db()
        self.assertEqual(offer.status, JobOffer.Status.SENT)
        self.assertTrue(offer.response_token)
        self.assertEqual(response.data["data"]["delivery"]["warnings"], ["Job offer delivery failed."])
        self.assertTrue(AuditLog.objects.filter(action="job_offer_delivery_failed", entity_id=str(offer.id)).exists())

    @patch("job_offers.views.notify_job_offer_biotime_mapping_missing", return_value=[])
    @patch("job_offers.services.send_user_invite_whatsapp")
    def test_account_invite_acceptance_binds_existing_prehire_profile(self, send_invite, _notify_missing):
        send_invite.return_value = {"success": True, "provider": "evolution_whatsapp"}
        offer = self.send_offer(self.create_offer())
        self.client.post(
            "/job-offers/respond/",
            {"token": offer.response_token, "decision": "accepted"},
            format="json",
        )
        offer.refresh_from_db()
        invite = offer.account_invite
        accepted = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "email": offer.candidate_email,
                "phone_number": offer.candidate_phone_number,
                "full_name": offer.candidate_full_name,
                "password": "StrongCandidatePass123!",
            },
            format="json",
        )
        self.assertEqual(accepted.status_code, status.HTTP_201_CREATED, accepted.data)
        self.prehire.refresh_from_db()
        self.assertIsNotNone(self.prehire.user_id)
        self.assertEqual(self.prehire.employment_status, EmployeeProfile.EmploymentStatus.ACTIVE)
        self.assertEqual(EmployeeProfile.objects.filter(user=self.prehire.user).count(), 1)
