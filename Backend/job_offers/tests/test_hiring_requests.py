from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from core.services.workflow_engine import (
    _build_action_url_path,
    build_pending_approval_item,
    sync_workflow,
)
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from in_app_notifications.models import Notification, NotificationDelivery
from organization.models import OrganizationNode, UserOrganizationAccess

from ..models import HiringRequest, JobOffer
from ..serializers import JobOfferSerializer
from ..services import deliver_job_offer

User = get_user_model()


@override_settings(
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
    FRONTEND_URL="https://frontend.example.test",
)
class HiringRequestApiTests(APITestCase):
    def setUp(self):
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        ceo_group, _ = Group.objects.get_or_create(name="CEO")
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company = OrganizationNode.objects.create(
            code="HIRING", name="Hiring Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="HIRING-OTHER", name="Other Hiring Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.department = Department.objects.create(company=self.company, code="PRJ", name="Projects")
        self.position = Position.objects.create(company=self.company, code="ENG", name="Project Engineer")
        self.senior_position = Position.objects.create(
            company=self.company, code="SENG", name="Senior Project Engineer"
        )
        self.hr = User.objects.create_user(
            email="hiring.hr@example.com", password="StrongPass123!", full_name="HR User"
        )
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        EmployeeProfile.objects.create(
            user=self.hr,
            company=self.company,
            employee_id="HIR-HR-1",
            full_name="HR User",
            mobile="+201001111111",
            job_title="HR Manager",
        )
        self.ceo = User.objects.create_user(
            email="hiring.ceo@example.com", password="StrongPass123!", full_name="CEO User"
        )
        self.ceo.groups.add(ceo_group)
        EmployeeProfile.objects.create(
            user=self.ceo,
            company=self.company,
            employee_id="HIR-CEO-1",
            full_name="CEO User",
            mobile="+201002222222",
            job_title="Chief Executive Officer",
        )
        self.employee = User.objects.create_user(email="hiring.employee@example.com", password="StrongPass123!")
        self.employee.groups.add(employee_group)
        EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="HIR-EMP-1",
            full_name="Employee User",
        )
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

    @staticmethod
    def cv(name="candidate.pdf", content=b"%PDF-1.4\n1 0 obj\n%%EOF", content_type="application/pdf"):
        return SimpleUploadedFile(name, content, content_type=content_type)

    def hiring_payload(self, **overrides):
        payload = {
            "candidate_full_name": "Candidate Gate",
            "candidate_email": "candidate.gate@example.com",
            "candidate_phone_number": "+20 100 333 3333",
            "nationality": "Egyptian",
            "date_of_birth": "1995-02-03",
            "proposed_salary": "12500.00",
            "cv_file": self.cv(),
        }
        payload.update(overrides)
        return payload

    def create_draft(self, **overrides):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            "/hiring-requests/", self.hiring_payload(**overrides), format="multipart", **self.headers
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return HiringRequest.objects.get(id=response.data["data"]["id"])

    def make_status(self, request_status):
        hiring_request = self.create_draft()
        hiring_request.status = request_status
        if request_status != HiringRequest.Status.DRAFT:
            hiring_request.submitted_at = timezone.now()
        if request_status in {HiringRequest.Status.APPROVED, HiringRequest.Status.REJECTED}:
            hiring_request.ceo_decision_by = self.ceo
            hiring_request.ceo_decision_at = timezone.now()
        hiring_request.save()
        return hiring_request

    def offer_payload(self, hiring_request_id):
        return {
            "hiring_request_id": hiring_request_id,
            "candidate_full_name": "Client Override",
            "candidate_email": "override@example.com",
            "candidate_phone_number": "+201009999999",
            "nationality": "Override",
            "basic_salary": "1.00",
            "department_id": self.department.id,
            "position_id": self.position.id,
            "position_title": "Project Engineer",
            "expiry_date": (timezone.localdate() + timedelta(days=7)).isoformat(),
        }

    def create_linked_offer(self):
        approved = self.make_status(HiringRequest.Status.APPROVED)
        self.client.force_authenticate(self.hr)
        response = self.client.post("/job-offers/", self.offer_payload(approved.id), format="json", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return JobOffer.objects.get(id=response.data["data"]["id"]), approved

    def test_hr_creates_draft_with_private_cv_and_generated_reference(self):
        hiring_request = self.create_draft()
        response_data = self.client.get(f"/hiring-requests/{hiring_request.id}/", **self.headers).data["data"]

        self.assertEqual(hiring_request.status, HiringRequest.Status.DRAFT)
        self.assertRegex(hiring_request.reference_number, rf"^HRQ-HIRING-{timezone.localdate().year}-0001$")
        self.assertEqual(hiring_request.candidate_phone_number, "+201003333333")
        self.assertTrue(response_data["has_cv"])
        self.assertNotIn("cv_file", response_data)
        self.assertIn(f"/hiring-requests/{hiring_request.id}/cv/", response_data["cv_download_url"])
        self.assertTrue(AuditLog.objects.filter(action="hiring_request_created").exists())

    @patch("job_offers.notifications.EmailService")
    def test_submit_creates_ceo_notification_and_pending_whatsapp_delivery(self, email_service_class):
        email_service_class.return_value.send_html_email.return_value = {"success": True}
        hiring_request = self.create_draft()
        response = self.client.post(f"/hiring-requests/{hiring_request.id}/submit/", {}, **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        hiring_request.refresh_from_db()
        self.assertEqual(hiring_request.status, HiringRequest.Status.SUBMITTED)
        notification = Notification.objects.get(recipient=self.ceo, event_key="hiring_request.submitted")
        self.assertEqual(notification.company, self.company)
        expected_action_url = f"https://frontend.example.test/ceo/hiring-requests/{hiring_request.id}"
        self.assertEqual(notification.action_url, expected_action_url)
        self.assertNotEqual(notification.action_url, f"/hiring-requests/{hiring_request.id}")
        self.assertNotEqual(
            notification.action_url,
            f"https://frontend.example.test/hiring-requests/{hiring_request.id}",
        )
        email_kwargs = email_service_class.return_value.send_html_email.call_args.kwargs
        self.assertIn(expected_action_url, email_kwargs["html_content"])
        self.assertIn(expected_action_url, email_kwargs["fallback_text"])
        workflow_item = build_pending_approval_item(sync_workflow(hiring_request, actor=self.ceo))
        self.assertEqual(workflow_item["review_path"], expected_action_url)
        self.assertNotEqual(workflow_item["review_path"], f"/hiring-requests/{hiring_request.id}")
        self.assertTrue(
            NotificationDelivery.objects.filter(
                notification=notification,
                channel=NotificationDelivery.Channel.WHATSAPP,
                status=NotificationDelivery.Status.PENDING,
            ).exists()
        )
        self.assertTrue(AuditLog.objects.filter(action="hiring_request_submitted").exists())

    @patch("job_offers.notifications.EmailService")
    def test_ceo_approves_and_rejects_and_hr_is_notified(self, email_service_class):
        email_service_class.return_value.send_html_email.return_value = {"success": True}
        approved = self.make_status(HiringRequest.Status.SUBMITTED)
        rejected = self.make_status(HiringRequest.Status.SUBMITTED)

        self.client.force_authenticate(self.ceo)
        approve = self.client.post(
            f"/hiring-requests/{approved.id}/approve/", {"note": "Budget approved"}, format="json", **self.headers
        )
        reject = self.client.post(
            f"/hiring-requests/{rejected.id}/reject/", {"note": "Role paused"}, format="json", **self.headers
        )

        self.assertEqual(approve.status_code, status.HTTP_200_OK, approve.data)
        self.assertEqual(reject.status_code, status.HTTP_200_OK, reject.data)
        approved.refresh_from_db()
        rejected.refresh_from_db()
        self.assertEqual(approved.status, HiringRequest.Status.APPROVED)
        self.assertEqual(approved.ceo_decision_by, self.ceo)
        self.assertEqual(rejected.status, HiringRequest.Status.REJECTED)
        approved_notification = Notification.objects.get(recipient=self.hr, event_key="hiring_request.approved")
        rejected_notification = Notification.objects.get(recipient=self.hr, event_key="hiring_request.rejected")
        approved_url = f"https://frontend.example.test/hr/hiring-requests/{approved.id}"
        rejected_url = f"https://frontend.example.test/hr/hiring-requests/{rejected.id}"
        self.assertEqual(approved_notification.action_url, approved_url)
        self.assertEqual(rejected_notification.action_url, rejected_url)
        for notification, hiring_request in (
            (approved_notification, approved),
            (rejected_notification, rejected),
        ):
            self.assertNotEqual(notification.action_url, f"/hiring-requests/{hiring_request.id}")
            self.assertNotEqual(
                notification.action_url,
                f"https://frontend.example.test/hiring-requests/{hiring_request.id}",
            )
        email_calls = email_service_class.return_value.send_html_email.call_args_list
        self.assertTrue(any(approved_url in call.kwargs["html_content"] for call in email_calls))
        self.assertTrue(any(approved_url in call.kwargs["fallback_text"] for call in email_calls))
        self.assertTrue(any(rejected_url in call.kwargs["html_content"] for call in email_calls))
        self.assertTrue(any(rejected_url in call.kwargs["fallback_text"] for call in email_calls))

    def test_hiring_request_workflow_hr_detail_fallback_uses_frontend_route(self):
        hiring_request = self.create_draft()
        expected_url = f"https://frontend.example.test/hr/hiring-requests/{hiring_request.id}"

        self.assertEqual(_build_action_url_path("hiring_request", "hr", hiring_request.id), expected_url)
        self.assertEqual(_build_action_url_path("hiring_request", "", hiring_request.id), expected_url)
        self.assertNotEqual(expected_url, f"/hiring-requests/{hiring_request.id}")

    def test_hr_cannot_decide_and_ceo_cannot_edit(self):
        hiring_request = self.make_status(HiringRequest.Status.SUBMITTED)
        approve = self.client.post(f"/hiring-requests/{hiring_request.id}/approve/", {}, **self.headers)
        self.assertEqual(approve.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.ceo)
        edit = self.client.patch(
            f"/hiring-requests/{hiring_request.id}/",
            {"candidate_full_name": "CEO Override"},
            format="json",
            **self.headers,
        )
        self.assertEqual(edit.status_code, status.HTTP_403_FORBIDDEN)

    def test_company_scope_protects_detail_actions_and_cv(self):
        foreign = HiringRequest.objects.create(
            company=self.other_company,
            reference_number="HRQ-HIRING-OTHER-2026-0001",
            candidate_full_name="Foreign Candidate",
            proposed_salary=Decimal("1000"),
            cv_file=self.cv("foreign.pdf"),
            requested_by=self.hr,
            created_by=self.hr,
            updated_by=self.hr,
        )
        self.client.force_authenticate(self.hr)
        self.assertEqual(self.client.get(f"/hiring-requests/{foreign.id}/", **self.headers).status_code, 404)
        self.assertEqual(
            self.client.post(f"/hiring-requests/{foreign.id}/submit/", {}, **self.headers).status_code, 404
        )
        self.assertEqual(self.client.get(f"/hiring-requests/{foreign.id}/cv/", **self.headers).status_code, 404)

        local = self.create_draft()
        self.client.force_authenticate(self.employee)
        self.assertEqual(self.client.get(f"/hiring-requests/{local.id}/cv/", **self.headers).status_code, 403)

    @override_settings(MAX_HIRING_REQUEST_CV_SIZE_BYTES=20)
    def test_cv_rejects_unsupported_and_oversized_files(self):
        self.client.force_authenticate(self.hr)
        unsupported = self.client.post(
            "/hiring-requests/",
            self.hiring_payload(cv_file=self.cv("candidate.exe", b"MZ executable", "application/octet-stream")),
            format="multipart",
            **self.headers,
        )
        oversized = self.client.post(
            "/hiring-requests/",
            self.hiring_payload(cv_file=self.cv(content=b"%PDF-1.4" + (b"x" * 30))),
            format="multipart",
            **self.headers,
        )
        self.assertEqual(unsupported.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(oversized.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_job_offer_requires_approved_request_and_prefills_authoritative_fields(self):
        self.client.force_authenticate(self.hr)
        missing = self.client.post("/job-offers/", self.offer_payload(None), format="json", **self.headers)
        self.assertEqual(missing.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        for request_status in [
            HiringRequest.Status.DRAFT,
            HiringRequest.Status.SUBMITTED,
            HiringRequest.Status.REJECTED,
            HiringRequest.Status.CANCELLED,
        ]:
            hiring_request = self.make_status(request_status)
            blocked = self.client.post(
                "/job-offers/", self.offer_payload(hiring_request.id), format="json", **self.headers
            )
            self.assertEqual(blocked.status_code, status.HTTP_409_CONFLICT, (request_status, blocked.data))

        approved = self.make_status(HiringRequest.Status.APPROVED)
        created = self.client.post("/job-offers/", self.offer_payload(approved.id), format="json", **self.headers)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        offer = JobOffer.objects.get(id=created.data["data"]["id"])
        approved.refresh_from_db()
        self.assertEqual(approved.status, HiringRequest.Status.CONVERTED)
        self.assertEqual(offer.candidate_full_name, approved.candidate_full_name)
        self.assertEqual(offer.candidate_email, approved.candidate_email)
        self.assertEqual(offer.candidate_phone_number, approved.candidate_phone_number)
        self.assertEqual(offer.nationality, approved.nationality)
        self.assertEqual(offer.basic_salary, approved.proposed_salary)
        self.assertEqual(created.data["data"]["hiring_request_id"], approved.id)
        self.assertEqual(created.data["data"]["hiring_request_reference"], approved.reference_number)
        self.assertEqual(created.data["data"]["hiring_request_status"], HiringRequest.Status.CONVERTED)

        duplicate = self.client.post("/job-offers/", self.offer_payload(approved.id), format="json", **self.headers)
        self.assertEqual(duplicate.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(AuditLog.objects.filter(action="hiring_request_converted_to_job_offer").exists())

    def test_linked_offer_derives_reference_names_without_client_text_fields(self):
        approved = self.make_status(HiringRequest.Status.APPROVED)
        self.client.force_authenticate(self.hr)

        response = self.client.post(
            "/job-offers/",
            {
                "hiring_request_id": approved.id,
                "department_id": self.department.id,
                "position_id": self.position.id,
                "expiry_date": (timezone.localdate() + timedelta(days=7)).isoformat(),
            },
            format="json",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["data"]["department"], self.department.name)
        self.assertEqual(response.data["data"]["position_title"], self.position.name)
        offer = JobOffer.objects.get(id=response.data["data"]["id"])
        self.assertEqual(offer.department, self.department.name)
        self.assertEqual(offer.position_title, self.position.name)

    def test_legacy_serializer_still_requires_and_uses_position_text(self):
        base_payload = {
            "candidate_full_name": "Legacy Candidate",
            "department": "Legacy Department",
            "expiry_date": (timezone.localdate() + timedelta(days=7)).isoformat(),
        }
        missing_title = JobOfferSerializer(data=base_payload, context={"company": self.company})

        self.assertFalse(missing_title.is_valid())
        self.assertEqual(str(missing_title.errors["position_title"][0]), "This field is required.")

        serializer = JobOfferSerializer(
            data={**base_payload, "position_title": "Legacy Engineer"},
            context={"company": self.company},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        offer = serializer.save(
            company=self.company,
            reference_number="JO-LEGACY-SERIALIZER-1",
            hr_signer_user=self.hr,
            created_by=self.hr,
            updated_by=self.hr,
        )
        self.assertEqual(offer.position_title, "Legacy Engineer")
        self.assertEqual(offer.department, "Legacy Department")

    def test_linked_draft_offer_rejects_candidate_name_patch(self):
        offer, hiring_request = self.create_linked_offer()
        response = self.client.patch(
            f"/job-offers/{offer.id}/",
            {"candidate_full_name": "Unauthorized Override"},
            format="json",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.data)
        self.assertEqual(response.data["errors"][0]["field"], "candidate_full_name")
        offer.refresh_from_db()
        self.assertEqual(offer.candidate_full_name, hiring_request.candidate_full_name)

    def test_linked_draft_offer_rejects_other_source_field_patches(self):
        offer, hiring_request = self.create_linked_offer()
        attempted_values = {
            "candidate_email": "override@example.com",
            "candidate_phone_number": "+201009999999",
            "nationality": "Override",
            "basic_salary": "1.00",
        }

        for field, value in attempted_values.items():
            response = self.client.patch(
                f"/job-offers/{offer.id}/",
                {field: value},
                format="json",
                **self.headers,
            )
            self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, (field, response.data))
            self.assertEqual(response.data["errors"][0]["field"], field)

        offer.refresh_from_db()
        self.assertEqual(offer.candidate_email, hiring_request.candidate_email)
        self.assertEqual(offer.candidate_phone_number, hiring_request.candidate_phone_number)
        self.assertEqual(offer.nationality, hiring_request.nationality)
        self.assertEqual(offer.basic_salary, hiring_request.proposed_salary)

    def test_linked_draft_offer_allows_normal_offer_field_patch(self):
        offer, _hiring_request = self.create_linked_offer()
        response = self.client.patch(
            f"/job-offers/{offer.id}/",
            {
                "position_id": self.senior_position.id,
                "classification": "Professional",
                "department_id": self.department.id,
                "location": "Cairo",
                "housing_allowance": "2500.00",
                "transportation_allowance": "1000.00",
                "other_allowance": "500.00",
                "total_salary_package": "16500.00",
                "vacation": "30 days",
                "tickets": "Annual return ticket",
                "contract_status": "New",
                "contract_type": "Fixed term",
                "contract_duration": "2 years",
                "medical_insurance": "Class A",
                "offer_date": timezone.localdate().isoformat(),
                "expiry_date": (timezone.localdate() + timedelta(days=14)).isoformat(),
            },
            format="json",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        offer.refresh_from_db()
        self.assertEqual(offer.position_title, "Senior Project Engineer")
        self.assertEqual(offer.total_salary_package, Decimal("16500.00"))

    def test_legacy_draft_offer_can_still_edit_candidate_fields(self):
        offer = JobOffer.objects.create(
            company=self.company,
            candidate_full_name="Legacy Candidate",
            candidate_email="legacy@example.com",
            candidate_phone_number="+201005555555",
            nationality="Egyptian",
            position_title="Engineer",
            basic_salary=Decimal("10000.00"),
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number="JO-LEGACY-2026-0001",
            hr_signer_user=self.hr,
            created_by=self.hr,
            updated_by=self.hr,
        )
        self.client.force_authenticate(self.hr)
        response = self.client.patch(
            f"/job-offers/{offer.id}/",
            {
                "candidate_full_name": "Updated Legacy Candidate",
                "candidate_email": "updated.legacy@example.com",
                "candidate_phone_number": "+201006666666",
                "nationality": "Jordanian",
                "basic_salary": "11000.00",
            },
            format="json",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        offer.refresh_from_db()
        self.assertEqual(offer.candidate_full_name, "Updated Legacy Candidate")
        self.assertEqual(offer.candidate_email, "updated.legacy@example.com")
        self.assertEqual(offer.candidate_phone_number, "+201006666666")
        self.assertEqual(offer.nationality, "Jordanian")
        self.assertEqual(offer.basic_salary, Decimal("11000.00"))

    @patch("job_offers.services.WhatsAppService")
    @patch("job_offers.services.EmailService")
    def test_offer_delivery_sends_candidate_and_ceo_pdf_documents_and_email_attachments(
        self, email_service_class, whatsapp_service_class
    ):
        email_service = email_service_class.return_value
        email_service.upload_media.return_value = {"success": True, "media_url": "https://media.example/job-offer.pdf"}
        email_service.send_html_email.return_value = {
            "success": True,
            "provider": "bird",
            "message_id": "email-1",
            "status_code": 202,
        }
        whatsapp_service = whatsapp_service_class.return_value
        whatsapp_service.send_template_message.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "text-1",
            "status_code": 201,
        }
        whatsapp_service.send_document_message.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "doc-1",
            "status_code": 201,
        }
        offer = JobOffer.objects.create(
            company=self.company,
            candidate_full_name="Candidate Delivery",
            candidate_email="candidate.delivery@example.com",
            candidate_phone_number="+201004444444",
            position_title="Engineer",
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number="JO-HIRING-2026-0099",
            response_token=JobOffer.generate_response_token(),
            hr_signer_user=self.hr,
            created_by=self.hr,
            updated_by=self.hr,
        )

        metadata = deliver_job_offer(offer)

        self.assertEqual(whatsapp_service.send_document_message.call_count, 2)
        self.assertEqual(email_service.send_html_email.call_count, 2)
        for call in email_service.send_html_email.call_args_list:
            self.assertEqual(call.kwargs["attachments"][0]["mediaUrl"], "https://media.example/job-offer.pdf")
        self.assertTrue(metadata["candidate"]["whatsapp_pdf"]["sent"])
        self.assertTrue(metadata["candidate"]["email_pdf"]["sent"])
        self.assertTrue(metadata["ceo"]["recipients"][0]["whatsapp_pdf"]["sent"])
        self.assertTrue(metadata["ceo"]["recipients"][0]["email_pdf"]["sent"])
        self.assertEqual(metadata["warning_details"]["candidate_whatsapp_pdf"], [])
