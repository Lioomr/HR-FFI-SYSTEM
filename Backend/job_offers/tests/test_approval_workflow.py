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
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess

from ..models import JobOffer

User = get_user_model()


@override_settings(
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
    FRONTEND_URL="https://frontend.example.test",
)
class JobOfferApprovalWorkflowTests(APITestCase):
    def setUp(self):
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        ceo_group, _ = Group.objects.get_or_create(name="CEO")
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company = OrganizationNode.objects.create(
            code="APPROVAL", name="Approval Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="APPROVAL-OTHER", name="Other Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.department = Department.objects.create(company=self.company, code="OPS", name="Operations")
        self.position = Position.objects.create(company=self.company, code="OPS-MGR", name="Operations Manager")
        self.other_department = Department.objects.create(
            company=self.other_company, code="OTHER", name="Other Department"
        )
        self.other_position = Position.objects.create(company=self.other_company, code="OTHER", name="Other Position")
        self.hr = User.objects.create_user(
            email="approval-hr@example.com", password="StrongPass123!", full_name="Approval HR"
        )
        self.hr.groups.add(hr_group)
        self.ceo = User.objects.create_user(
            email="approval-ceo@example.com", password="StrongPass123!", full_name="Approval CEO"
        )
        self.ceo.groups.add(ceo_group)
        self.employee = User.objects.create_user(
            email="approval-employee@example.com", password="StrongPass123!", full_name="Employee"
        )
        self.employee.groups.add(employee_group)
        for user in (self.hr, self.ceo, self.employee):
            UserOrganizationAccess.objects.create(user=user, organization=self.company)
        EmployeeProfile.objects.create(
            user=self.hr,
            company=self.company,
            employee_id="APP-HR",
            full_name="Approval HR",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.ceo,
            company=self.company,
            employee_id="APP-CEO",
            full_name="Approval CEO",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="APP-EMP",
            full_name="Employee",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}
        self.email_patcher = patch(
            "job_offers.notifications.EmailService.send_html_email",
            return_value={"success": True, "provider": "bird", "status_code": 202},
        )
        self.email_patcher.start()
        self.addCleanup(self.email_patcher.stop)

    @staticmethod
    def cv(name="candidate.pdf", content=b"%PDF-1.4\n%%EOF", content_type="application/pdf"):
        return SimpleUploadedFile(name, content, content_type=content_type)

    def payload(self, **overrides):
        payload = {
            "candidate_full_name": "Candidate Approval",
            "candidate_email": "candidate.approval@example.com",
            "candidate_phone_number": "+201003333333",
            "nationality": "Egyptian",
            "date_of_birth": "1992-04-03",
            "id_passport_iqama_number": "P-12345",
            "cv_file": self.cv(),
            "department_id": self.department.id,
            "position_id": self.position.id,
            "classification": "Management",
            "location": "Riyadh",
            "basic_salary": "12000.00",
            "housing_allowance": "3000.00",
            "transportation_allowance": "1000.00",
            "other_allowance": "500.00",
            "total_salary_package": "16500.00",
            "vacation": "30 calendar days",
            "tickets": "Annual return ticket",
            "contract_status": "New",
            "contract_type": "Fixed term",
            "contract_duration": "2 years",
            "medical_insurance": "Class A",
            "offer_date": timezone.localdate().isoformat(),
            "expiry_date": (timezone.localdate() + timedelta(days=14)).isoformat(),
        }
        payload.update(overrides)
        return payload

    def create_offer(self, **overrides):
        self.client.force_authenticate(self.hr)
        response = self.client.post("/job-offers/", self.payload(**overrides), format="multipart", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return JobOffer.objects.get(pk=response.data["data"]["id"])

    def submit(self, offer):
        self.client.force_authenticate(self.hr)
        return self.client.post(f"/job-offers/{offer.id}/submit/", {}, format="json", **self.headers)

    def test_direct_create_requires_and_validates_private_cv(self):
        self.client.force_authenticate(self.hr)
        missing_payload = self.payload()
        missing_payload.pop("cv_file")
        missing = self.client.post("/job-offers/", missing_payload, format="multipart", **self.headers)
        invalid = self.client.post(
            "/job-offers/",
            self.payload(cv_file=self.cv(content=b"not a pdf")),
            format="multipart",
            **self.headers,
        )
        valid = self.client.post("/job-offers/", self.payload(), format="multipart", **self.headers)

        self.assertEqual(missing.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(invalid.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(valid.status_code, status.HTTP_201_CREATED, valid.data)
        self.assertEqual(valid.data["data"]["approval_status"], JobOffer.ApprovalStatus.DRAFT)
        self.assertTrue(valid.data["data"]["has_cv"])
        self.assertIn(f"/job-offers/{valid.data['data']['id']}/cv/", valid.data["data"]["cv_download_url"])
        self.assertNotIn("cv_file", valid.data["data"])

    @override_settings(MAX_JOB_OFFER_CV_SIZE_BYTES=20)
    def test_cv_size_and_declared_type_are_enforced(self):
        self.client.force_authenticate(self.hr)
        oversized = self.client.post(
            "/job-offers/",
            self.payload(cv_file=self.cv(content=b"%PDF-1.4" + (b"x" * 30))),
            format="multipart",
            **self.headers,
        )
        mismatched = self.client.post(
            "/job-offers/",
            self.payload(cv_file=self.cv(name="candidate.png", content_type="image/png")),
            format="multipart",
            **self.headers,
        )
        self.assertEqual(oversized.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(mismatched.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_cv_download_is_attachment_audited_role_authorized_and_company_scoped(self):
        offer = self.create_offer()
        submit = self.submit(offer)
        self.assertEqual(submit.status_code, status.HTTP_200_OK, submit.data)

        self.client.force_authenticate(self.ceo)
        allowed = self.client.get(f"/job-offers/{offer.id}/cv/", **self.headers)
        self.assertEqual(allowed.status_code, status.HTTP_200_OK)
        self.assertEqual(allowed["Content-Type"], "application/octet-stream")
        self.assertIn("attachment", allowed["Content-Disposition"].lower())
        self.assertEqual(allowed["X-Content-Type-Options"], "nosniff")
        self.assertEqual(allowed["Cache-Control"], "private, no-store")
        self.assertTrue(AuditLog.objects.filter(action="job_offer_cv_downloaded", entity_id=str(offer.id)).exists())

        self.client.force_authenticate(self.employee)
        forbidden = self.client.get(f"/job-offers/{offer.id}/cv/", **self.headers)
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        foreign = JobOffer.objects.create(
            company=self.other_company,
            candidate_full_name="Foreign Candidate",
            candidate_email="foreign@example.com",
            cv_file=self.cv("foreign.pdf"),
            department_ref=self.other_department,
            position_ref=self.other_position,
            department=self.other_department.name,
            position_title=self.other_position.name,
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number="JO-FOREIGN-1",
            hr_signer_user=self.hr,
            created_by=self.hr,
            updated_by=self.hr,
            approval_status=JobOffer.ApprovalStatus.PENDING_CEO,
        )
        self.client.force_authenticate(self.ceo)
        hidden = self.client.get(f"/job-offers/{foreign.id}/cv/", **self.headers)
        self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)

    def test_revision_loop_ceo_commercial_edit_approval_notifications_and_history(self):
        offer = self.create_offer()
        submitted = self.submit(offer)
        self.assertEqual(submitted.status_code, status.HTTP_200_OK, submitted.data)
        offer.refresh_from_db()
        self.assertEqual(offer.approval_status, JobOffer.ApprovalStatus.PENDING_CEO)
        self.assertTrue(Notification.objects.filter(recipient=self.ceo, event_key="job_offer.submitted").exists())
        self.assertTrue(
            AuditLog.objects.filter(action="job_offer_submitted_for_ceo_approval", entity_id=str(offer.id)).exists()
        )

        self.client.force_authenticate(self.ceo)
        detail = self.client.get(f"/job-offers/{offer.id}/", **self.headers)
        self.assertTrue(detail.data["data"]["workflow"]["can_approve"])
        self.assertTrue(detail.data["data"]["workflow"]["can_request_changes"])
        self.assertFalse(detail.data["data"]["workflow"]["can_cancel"])
        identity_edit = self.client.patch(
            f"/job-offers/{offer.id}/",
            {"candidate_full_name": "CEO Override", "cv_file": self.cv("replacement.pdf")},
            format="multipart",
            **self.headers,
        )
        self.assertEqual(identity_edit.status_code, status.HTTP_403_FORBIDDEN)
        commercial_edit = self.client.patch(
            f"/job-offers/{offer.id}/",
            {"basic_salary": "13000.00", "location": "Jeddah", "contract_duration": "3 years"},
            format="json",
            **self.headers,
        )
        self.assertEqual(commercial_edit.status_code, status.HTTP_200_OK, commercial_edit.data)
        offer.refresh_from_db()
        self.assertEqual(offer.basic_salary, Decimal("13000.00"))
        self.assertEqual(offer.location, "Jeddah")

        changes = self.client.post(
            f"/job-offers/{offer.id}/request-changes/",
            {"reason": "Adjust the package", "recommendation": "Use the approved salary band"},
            format="json",
            **self.headers,
        )
        self.assertEqual(changes.status_code, status.HTTP_200_OK, changes.data)
        offer.refresh_from_db()
        self.assertEqual(offer.approval_status, JobOffer.ApprovalStatus.CHANGES_REQUESTED)
        self.assertEqual(offer.ceo_recommendation, "Use the approved salary band")
        self.assertTrue(
            Notification.objects.filter(recipient=self.hr, event_key="job_offer.changes_requested").exists()
        )

        self.client.force_authenticate(self.hr)
        returned = self.client.get(f"/job-offers/{offer.id}/", **self.headers)
        self.assertTrue(returned.data["data"]["workflow"]["can_submit"])
        revised = self.client.patch(
            f"/job-offers/{offer.id}/",
            {"housing_allowance": "3500.00"},
            format="json",
            **self.headers,
        )
        self.assertEqual(revised.status_code, status.HTTP_200_OK, revised.data)
        resubmitted = self.submit(offer)
        self.assertEqual(resubmitted.status_code, status.HTTP_200_OK, resubmitted.data)

        self.client.force_authenticate(self.ceo)
        approved = self.client.post(
            f"/job-offers/{offer.id}/approve/",
            {"recommendation": "Proceed"},
            format="json",
            **self.headers,
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.data)
        self.assertEqual(approved.data["data"]["approval_status"], JobOffer.ApprovalStatus.APPROVED)
        self.assertEqual(approved.data["data"]["ceo_decision_by_id"], self.ceo.id)
        self.assertEqual(approved.data["data"]["ceo_recommendation"], "Proceed")
        history = approved.data["data"]["workflow"]["history"]
        self.assertEqual([item["action"] for item in history], ["submit", "request_changes", "submit", "approve"])
        self.assertEqual(history[-1]["metadata"]["recommendation"], "Proceed")
        self.assertTrue(Notification.objects.filter(recipient=self.hr, event_key="job_offer.approved").exists())
        for action in (
            "job_offer_ceo_commercial_fields_updated",
            "job_offer_changes_requested",
            "job_offer_ceo_approved",
        ):
            self.assertTrue(AuditLog.objects.filter(action=action, entity_id=str(offer.id)).exists())

        self.client.force_authenticate(self.hr)
        blocked_edit = self.client.patch(
            f"/job-offers/{offer.id}/", {"location": "Dammam"}, format="json", **self.headers
        )
        self.assertEqual(blocked_edit.status_code, status.HTTP_409_CONFLICT)
        with patch("job_offers.views.deliver_job_offer", return_value={"channels": {}, "warnings": []}):
            sent = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(sent.status_code, status.HTTP_200_OK, sent.data)

    def test_rejection_requires_reason_is_terminal_and_blocks_send(self):
        offer = self.create_offer()
        self.assertEqual(self.submit(offer).status_code, status.HTTP_200_OK)
        self.client.force_authenticate(self.ceo)
        missing_reason = self.client.post(
            f"/job-offers/{offer.id}/reject/", {"recommendation": "Pause"}, format="json", **self.headers
        )
        self.assertEqual(missing_reason.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        rejected = self.client.post(
            f"/job-offers/{offer.id}/reject/",
            {"reason": "Position is no longer authorized"},
            format="json",
            **self.headers,
        )
        self.assertEqual(rejected.status_code, status.HTTP_200_OK, rejected.data)
        self.assertEqual(rejected.data["data"]["approval_status"], JobOffer.ApprovalStatus.REJECTED)
        self.assertEqual(rejected.data["data"]["ceo_decision_reason"], "Position is no longer authorized")
        self.assertTrue(Notification.objects.filter(recipient=self.hr, event_key="job_offer.rejected").exists())
        self.assertTrue(AuditLog.objects.filter(action="job_offer_ceo_rejected", entity_id=str(offer.id)).exists())

        self.client.force_authenticate(self.hr)
        self.assertEqual(self.submit(offer).status_code, status.HTTP_409_CONFLICT)
        blocked_send = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(blocked_send.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(blocked_send.data["message"], "CEO approval is required before sending this job offer.")

    def test_role_authorization_and_company_isolation_cover_workflow_actions(self):
        offer = self.create_offer()
        self.client.force_authenticate(self.employee)
        self.assertEqual(self.client.get("/job-offers/", **self.headers).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.post(f"/job-offers/{offer.id}/submit/", {}, format="json", **self.headers).status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.client.force_authenticate(self.hr)
        self.assertEqual(
            self.client.post(f"/job-offers/{offer.id}/approve/", {}, format="json", **self.headers).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(self.submit(offer).status_code, status.HTTP_200_OK)

        foreign = JobOffer.objects.create(
            company=self.other_company,
            candidate_full_name="Foreign Candidate",
            candidate_email="foreign@example.com",
            cv_file=self.cv("foreign-auth.pdf"),
            department_ref=self.other_department,
            position_ref=self.other_position,
            department=self.other_department.name,
            position_title=self.other_position.name,
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number="JO-FOREIGN-AUTH",
            hr_signer_user=self.hr,
            created_by=self.hr,
            updated_by=self.hr,
            approval_status=JobOffer.ApprovalStatus.PENDING_CEO,
        )
        self.client.force_authenticate(self.ceo)
        self.assertEqual(
            self.client.get(f"/job-offers/{foreign.id}/", **self.headers).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.post(f"/job-offers/{foreign.id}/approve/", {}, format="json", **self.headers).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        create = self.client.post("/job-offers/", self.payload(), format="multipart", **self.headers)
        self.assertEqual(create.status_code, status.HTTP_403_FORBIDDEN)

    def test_send_is_blocked_until_approval(self):
        offer = self.create_offer()
        self.client.force_authenticate(self.hr)
        draft = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(draft.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.submit(offer).status_code, status.HTTP_200_OK)
        pending = self.client.post(f"/job-offers/{offer.id}/send/", {}, format="json", **self.headers)
        self.assertEqual(pending.status_code, status.HTTP_409_CONFLICT)
