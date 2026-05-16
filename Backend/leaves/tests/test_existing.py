from datetime import date, timedelta
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from pypdf import PdfReader
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.services import get_workflow_snapshot
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.views import _approval_path_rows, _leave_type_labels
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class LeaveManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Setup Roles
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        # Admin User
        self.admin = User.objects.create_user(email="admin@ffi.com", password="password")
        self.admin.groups.add(self.admin_group)

        # HR User
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        # Employee 1
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)

        # Employee 2
        self.emp2 = User.objects.create_user(email="emp2@ffi.com", password="password")
        self.emp2.groups.add(self.employee_group)

        # Leave Types
        self.annual_leave = LeaveType.objects.create(name="Annual Leave", code="ANNUAL")
        self.sick_leave = LeaveType.objects.create(name="Sick Leave", code="SICK")

    # --- Leave Types ---
    def test_leave_type_crud_admin(self):
        self.client.force_authenticate(user=self.admin)
        data = {"name": "Unpaid Leave", "code": "UNPAID", "is_paid": False}
        response = self.client.post("/api/leaves/leave-types/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(LeaveType.objects.filter(code="UNPAID").exists())
        # Audit
        self.assertTrue(
            AuditLog.objects.filter(action="leave_type_created", entity_id=response.data["data"]["id"]).exists()
        )

    def test_leave_type_soft_delete(self):
        self.client.force_authenticate(user=self.admin)
        type_to_delete = LeaveType.objects.create(name="Delete Me", code="DEL")

        response = self.client.delete(f"/api/leaves/leave-types/{type_to_delete.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify it still exists but is inactive
        type_to_delete.refresh_from_db()
        self.assertFalse(type_to_delete.is_active)
        self.assertTrue(AuditLog.objects.filter(action="leave_type_deactivated", entity_id=type_to_delete.id).exists())

    def test_leave_type_read_only_employee(self):
        self.client.force_authenticate(user=self.emp1)
        # Employee sees only active types. setUp created 2 active types.

        # Test Create Forbidden
        response = self.client.post("/api/leaves/leave-types/", {"name": "Hack", "code": "HACK"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Test List
        response = self.client.get("/api/leaves/leave-types/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 2)

    def test_employee_leave_type_list_seeds_company_policy_types(self):
        company = OrganizationNode.objects.create(
            code="COMPANY_WITHOUT_TYPES",
            name="Company Without Types",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        EmployeeProfile.objects.create(
            user=self.emp1,
            company=company,
            employee_id="EMP-WITHOUT-TYPES",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.client.force_authenticate(user=self.emp1)
        response = self.client.get("/api/leaves/leave-types/", follow=True)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = {item["code"] for item in response.data["data"]}
        self.assertIn("ANNUAL", codes)
        self.assertIn("SICK", codes)
        self.assertTrue(LeaveType.objects.filter(company=company, code="ANNUAL", is_active=True).exists())

    # --- Leave Requests ---
    def test_create_leave_request_flow(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=1)
        end = date.today() + timedelta(days=5)

        data = {"leave_type": self.annual_leave.id, "start_date": str(start), "end_date": str(end), "reason": "Holiday"}

        # 1. Create
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        req_id = response.data["data"]["id"]

        # 2. Verify Status
        req = LeaveRequest.objects.get(pk=req_id)
        # NOTE: Updated to PENDING_HR default, but logic might set to PENDING_MANAGER if manager exists.
        # Here emp1 has no manager set in setUp, so it should default to PENDING_HR.
        # The test originally expected "PENDING". The model default changed to PENDING_HR.
        # But wait, RequestStatus.PENDING was removed? No, I updated RequestStatus choices.
        # Ah, I replaced PENDING with PENDING_MANAGER and PENDING_HR.
        # So this test WILL FAIL if it expects "PENDING".
        # I need to update this test to expect "PENDING_HR".
        self.assertEqual(req.status, LeaveRequest.RequestStatus.PENDING_HR)
        self.assertEqual(req.employee, self.emp1)

        # 3. Approve (HR)
        self.client.force_authenticate(user=self.hr)
        response = self.client.post(f"/api/leaves/leave-requests/{req_id}/approve/", {"decision_reason": "Enjoy"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")
        self.assertEqual(req.decided_by, self.hr)

    def test_hr_manager_self_request_starts_pending_ceo(self):
        self.client.force_authenticate(user=self.hr)
        start = date.today() + timedelta(days=2)
        end = date.today() + timedelta(days=3)
        data = {
            "leave_type": self.annual_leave.id,
            "start_date": str(start),
            "end_date": str(end),
            "reason": "HR leave",
        }
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_CEO)

    def test_hr_manager_self_request_without_profile_uses_leave_type_company(self):
        company = OrganizationNode.objects.create(
            code="FFI_HR_SELF",
            name="FFI HR Self",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        UserOrganizationAccess.objects.create(user=self.hr, organization=company)
        leave_type = LeaveType.objects.create(company=company, name="Company Annual", code="COMPANY_ANNUAL")

        self.client.force_authenticate(user=self.hr)
        start = date.today() + timedelta(days=20)
        end = date.today() + timedelta(days=21)
        response = self.client.post(
            "/api/leaves/leave-requests/",
            {"leave_type": leave_type.id, "start_date": str(start), "end_date": str(end), "reason": "HR leave"},
            HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        request_id = response.data["data"]["id"]
        request = LeaveRequest.objects.get(id=request_id)
        self.assertEqual(request.company, company)

        response = self.client.get(
            f"/api/leaves/leave-requests/{request_id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_annual_leave_allowed_after_six_months_service(self):
        from employees.models import EmployeeProfile

        hire_date = date.today() - timedelta(days=200)
        EmployeeProfile.objects.create(
            user=self.emp1,
            employee_id="EMP-SIX-MONTHS",
            hire_date=hire_date,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=1)
        end = date.today() + timedelta(days=2)
        response = self.client.post(
            "/api/leaves/leave-requests/",
            {
                "leave_type": self.annual_leave.id,
                "start_date": str(start),
                "end_date": str(end),
                "reason": "Eligible after six months",
            },
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_cancel_leave_request(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=10)
        end = date.today() + timedelta(days=12)

        # Create
        req = LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.sick_leave,
            start_date=start,
            end_date=end,
            status=LeaveRequest.RequestStatus.PENDING_HR,  # Ensure pending state
        )

        # Cancel
        response = self.client.post(f"/api/leaves/leave-requests/{req.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")
        workflow = get_workflow_snapshot(req, actor=self.emp1)
        self.assertEqual(workflow["status"], "cancelled")
        self.assertTrue(any(item["action"] == "cancel" for item in workflow["history"]))

    def test_view_others_request_forbidden(self):
        # Emp1 creates request
        req = LeaveRequest.objects.create(
            employee=self.emp1, leave_type=self.sick_leave, start_date=date.today(), end_date=date.today()
        )

        # Emp2 tries to view
        self.client.force_authenticate(user=self.emp2)
        response = self.client.get(f"/api/leaves/leave-requests/{req.id}/")

        # 500 debug: likely get_role or something else.
        # But expecting 404.
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_employee_can_download_leave_request_pdf(self):
        req = LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual_leave,
            start_date=date.today() + timedelta(days=4),
            end_date=date.today() + timedelta(days=6),
            status=LeaveRequest.RequestStatus.PENDING_HR,
            reason="Family event",
        )

        self.client.force_authenticate(user=self.emp1)
        response = self.client.get(f"/api/leaves/leave-requests/{req.id}/pdf/?download=1")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn(f"leave_request_{req.id}.pdf", response["Content-Disposition"])
        reader = PdfReader(BytesIO(response.content))
        extracted_text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertEqual(len(reader.pages), 2)
        self.assertIn("Pending", extracted_text)
        self.assertNotIn("pending_hr", extracted_text)

    def test_leave_type_labels_translate_known_arabic_policy_labels(self):
        english, arabic = _leave_type_labels(LeaveType(name="Unpaid Leave", code="UNPAID"))

        self.assertEqual(english, "Unpaid Leave")
        self.assertEqual(arabic, "اجازه بدون راتب")

    def test_approval_path_rows_include_stage_actor_names(self):
        self.emp1.full_name = "Employee One"
        self.emp1.save(update_fields=["full_name"])
        self.hr.full_name = "HR User"
        self.hr.save(update_fields=["full_name"])

        req = LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual_leave,
            start_date=date.today() + timedelta(days=4),
            end_date=date.today() + timedelta(days=6),
            status=LeaveRequest.RequestStatus.PENDING_HR,
            decided_by=self.hr,
        )

        rows = _approval_path_rows(req)

        self.assertEqual(rows[0][3], "Employee One")
        self.assertEqual(rows[2][3], "HR User")

    def test_overlapping_requests_forbidden(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=20)
        end = date.today() + timedelta(days=25)

        # Request 1
        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual_leave,
            start_date=start,
            end_date=end,
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )

        # Request 2 (Overlap)
        data = {
            "leave_type": self.annual_leave.id,
            "start_date": str(start + timedelta(days=2)),  # Inside range
            "end_date": str(end + timedelta(days=2)),
            "reason": "Overlap",
        }
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        # Serializer validation error wrapped in error()
        # likely: { "status": "error", "message": "Validation Error", "errors": ["You already have..."] }
        self.assertIn("already have a pending or approved leave", str(response.data))

    def test_start_after_end_fail(self):
        self.client.force_authenticate(user=self.emp1)
        data = {
            "leave_type": self.annual_leave.id,
            "start_date": "2024-01-05",
            "end_date": "2024-01-01",  # Fail
        }
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_sick_leave_requires_document(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=3)
        end = date.today() + timedelta(days=4)
        data = {
            "leave_type": self.sick_leave.id,
            "start_date": str(start),
            "end_date": str(end),
            "reason": "Flu",
        }
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("document", str(response.data))

    def test_sick_leave_with_document_allowed(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=6)
        end = date.today() + timedelta(days=7)
        document = SimpleUploadedFile("medical_report.pdf", b"approved report", content_type="application/pdf")
        data = {
            "leave_type": self.sick_leave.id,
            "start_date": str(start),
            "end_date": str(end),
            "reason": "Doctor advised rest",
            "document": document,
        }
        response = self.client.post("/api/leaves/leave-requests/", data, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_leave_request_notifies_delegate_when_selected(self):
        from employees.models import EmployeeProfile

        company = OrganizationNode.objects.create(
            code="LEAVE_DELEGATION_CO",
            name="Leave Delegation Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        EmployeeProfile.objects.create(
            user=self.emp1,
            company=company,
            employee_id="EMP-DEL-SEND",
            full_name="Delegation Sender",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.emp2,
            company=company,
            employee_id="EMP-DEL-RECV",
            full_name="Delegation Receiver",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.client.force_authenticate(user=self.emp1)
        with patch("leaves.views.notify_delegation_assigned") as notify_delegate:
            response = self.client.post(
                "/api/leaves/leave-requests/",
                {
                    "leave_type": self.annual_leave.id,
                    "start_date": str(date.today() + timedelta(days=40)),
                    "end_date": str(date.today() + timedelta(days=41)),
                    "reason": "Delegation notification test",
                    "delegated_to": self.emp2.id,
                    "delegation_note": "Please cover urgent work.",
                },
                HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        notify_delegate.assert_called_once()
        request_obj = LeaveRequest.objects.get(pk=response.data["data"]["id"])
        self.assertEqual(request_obj.delegated_to, self.emp2)
        self.assertEqual(request_obj.status, LeaveRequest.RequestStatus.PENDING_DELEGATE)
        workflow = get_workflow_snapshot(request_obj, actor=self.emp2)
        self.assertEqual(workflow["current_stage"], "delegate")
        self.assertTrue(workflow["can_approve"])

    def test_employee_can_create_leave_request_with_cross_company_delegate(self):
        from employees.models import EmployeeProfile

        requester_company = OrganizationNode.objects.create(
            code="LEAVE_CROSS_REQUESTER",
            name="Leave Cross Requester",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        delegate_company = OrganizationNode.objects.create(
            code="LEAVE_CROSS_DELEGATE",
            name="Leave Cross Delegate",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        EmployeeProfile.objects.create(
            user=self.emp1,
            company=requester_company,
            employee_id="EMP-CROSS-SEND",
            full_name="Cross Sender",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.emp2,
            company=delegate_company,
            employee_id="EMP-CROSS-RECV",
            full_name="Cross Receiver",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.client.force_authenticate(user=self.emp1)
        response = self.client.post(
            "/api/leaves/leave-requests/",
            {
                "leave_type": self.annual_leave.id,
                "start_date": str(date.today() + timedelta(days=40)),
                "end_date": str(date.today() + timedelta(days=41)),
                "reason": "Cross-company coverage",
                "delegated_to": self.emp2.id,
                "delegation_note": "Please cover with the other company.",
            },
            HTTP_X_ACTIVE_COMPANY_ID=str(requester_company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        request_obj = LeaveRequest.objects.get(pk=response.data["data"]["id"])
        self.assertEqual(request_obj.company, requester_company)
        self.assertEqual(request_obj.delegated_to, self.emp2)
        self.assertEqual(request_obj.status, LeaveRequest.RequestStatus.PENDING_DELEGATE)

    def test_delegate_approval_moves_leave_request_to_hr(self):
        from employees.models import EmployeeProfile

        company = OrganizationNode.objects.create(
            code="LEAVE_DELEGATE_APPROVAL_CO",
            name="Leave Delegate Approval Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        EmployeeProfile.objects.create(
            user=self.emp1,
            company=company,
            employee_id="EMP-DEL-APP-SEND",
            full_name="Delegation Sender",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.emp2,
            company=company,
            employee_id="EMP-DEL-APP-RECV",
            full_name="Delegation Receiver",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        request_obj = LeaveRequest.objects.create(
            employee=self.emp1,
            employee_profile=self.emp1.employee_profile,
            company=company,
            leave_type=self.annual_leave,
            start_date=date.today() + timedelta(days=50),
            end_date=date.today() + timedelta(days=51),
            status=LeaveRequest.RequestStatus.PENDING_DELEGATE,
            delegated_to=self.emp2,
            delegation_note="Cover urgent items.",
        )
        sync = get_workflow_snapshot(request_obj, actor=self.emp2)
        self.assertEqual(sync["current_stage"], "delegate")

        self.client.force_authenticate(user=self.emp2)
        response = self.client.post(
            f"/api/leaves/leave-requests/{request_obj.id}/delegate-approve/",
            {"comment": "I can cover this."},
            HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, LeaveRequest.RequestStatus.PENDING_HR)
        self.assertEqual(request_obj.delegate_decision_by, self.emp2)
        self.assertEqual(request_obj.delegate_decision_note, "I can cover this.")
        workflow = get_workflow_snapshot(request_obj, actor=self.hr)
        self.assertEqual(workflow["current_stage"], "hr")
        self.assertTrue(
            any(item["stage"] == "delegate" and item["action"] == "approve" for item in workflow["history"])
        )

    def test_delegated_employee_can_list_and_view_assigned_leave_request(self):
        from employees.models import EmployeeProfile

        company = OrganizationNode.objects.create(
            code="LEAVE_DELEGATE_INBOX_CO",
            name="Leave Delegate Inbox Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        EmployeeProfile.objects.create(
            user=self.emp1,
            company=company,
            employee_id="EMP-DEL-INBOX-SEND",
            full_name="Delegation Sender",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.emp2,
            company=company,
            employee_id="EMP-DEL-INBOX-RECV",
            full_name="Delegation Receiver",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        request_obj = LeaveRequest.objects.create(
            employee=self.emp1,
            employee_profile=self.emp1.employee_profile,
            company=company,
            leave_type=self.annual_leave,
            start_date=date.today() + timedelta(days=60),
            end_date=date.today() + timedelta(days=61),
            status=LeaveRequest.RequestStatus.PENDING_DELEGATE,
            delegated_to=self.emp2,
            delegation_note="Cover urgent items.",
        )

        self.client.force_authenticate(user=self.emp2)
        list_response = self.client.get(
            "/api/leaves/employee/delegated-leave-requests/",
            HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
            secure=True,
        )
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data["data"]["count"], 1)
        self.assertEqual(list_response.data["data"]["items"][0]["id"], request_obj.id)

        detail_response = self.client.get(
            f"/api/leaves/leave-requests/{request_obj.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
            secure=True,
        )
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["data"]["id"], request_obj.id)
        self.assertTrue(detail_response.data["data"]["workflow"]["can_approve"])

    def test_delegated_employee_can_view_assigned_request_without_active_company_header(self):
        from employees.models import EmployeeProfile

        company = OrganizationNode.objects.create(
            code="LEAVE_DELEGATE_DIRECT_CO",
            name="Leave Delegate Direct Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        EmployeeProfile.objects.create(
            user=self.emp1,
            company=company,
            employee_id="EMP-DEL-DIRECT-SEND",
            full_name="Delegation Sender",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.emp2,
            company=company,
            employee_id="EMP-DEL-DIRECT-RECV",
            full_name="Delegation Receiver",
            hire_date=date.today() - timedelta(days=700),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        request_obj = LeaveRequest.objects.create(
            employee=self.emp1,
            employee_profile=self.emp1.employee_profile,
            company=company,
            leave_type=self.annual_leave,
            start_date=date.today() + timedelta(days=70),
            end_date=date.today() + timedelta(days=71),
            status=LeaveRequest.RequestStatus.PENDING_DELEGATE,
            delegated_to=self.emp2,
            delegation_note="Cover urgent items.",
        )
        get_workflow_snapshot(request_obj, actor=self.emp2)

        self.client.force_authenticate(user=self.emp2)
        detail_response = self.client.get(f"/api/leaves/leave-requests/{request_obj.id}/")

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["data"]["id"], request_obj.id)
        self.assertTrue(detail_response.data["data"]["workflow"]["can_approve"])

    def test_delete_leave_request_forbidden(self):
        self.client.force_authenticate(user=self.admin)
        start = date.today() + timedelta(days=30)
        end = date.today() + timedelta(days=35)
        req = LeaveRequest.objects.create(
            employee=self.emp1, leave_type=self.annual_leave, start_date=start, end_date=end
        )

        response = self.client.delete(f"/api/leaves/leave-requests/{req.id}/")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class LeaveBalanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Setup Roles & Users
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        # Create Users
        from employees.models import EmployeeProfile

        # HR
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        # Employee
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)
        self.profile1 = EmployeeProfile.objects.create(
            user=self.emp1,
            employee_id="EMP001",
            hire_date=date.today() - timedelta(days=700),  # Hired 2 years ago
        )

        # Leave Types
        self.annual = LeaveType.objects.create(
            name="Annual Leave", code="ANNUAL", annual_quota=21.0, allow_carry_over=False
        )
        self.sick = LeaveType.objects.create(
            name="Sick Leave", code="SICK", annual_quota=10.0, allow_carry_over=True, max_carry_over=5.0
        )

    def test_balance_calculation_simple(self):
        # No usage
        from leaves.utils import calculate_leave_balance

        year = date.today().year
        balances = calculate_leave_balance(self.emp1, year, as_of=date(year, 12, 31))

        # Find annual leave
        annual_bal = next(b for b in balances if b["leave_type_id"] == self.annual.id)
        self.assertEqual(float(annual_bal["remaining_days"]), 21.0)
        self.assertEqual(float(annual_bal["used_days"]), 0.0)
        self.assertEqual(float(annual_bal["available_annual_year_days"]), 21.0)

    def test_annual_accrual_for_started_months(self):
        from leaves.utils import calculate_leave_balance, get_annual_accrued_days

        self.profile1.hire_date = date(2024, 1, 1)
        self.profile1.save()

        self.assertEqual(get_annual_accrued_days(self.profile1, 2026, as_of=date(2026, 5, 17)), 8.75)

        balances = calculate_leave_balance(self.emp1, 2026, as_of=date(2026, 5, 17))
        annual_bal = next(b for b in balances if b["leave_type_id"] == self.annual.id)
        self.assertEqual(float(annual_bal["available_annual_year_days"]), 8.75)
        self.assertEqual(float(annual_bal["remaining_days"]), 8.75)

    def test_annual_accrual_caps_at_full_year(self):
        from leaves.utils import get_annual_accrued_days

        self.profile1.hire_date = date(2024, 1, 1)
        self.profile1.save()

        self.assertEqual(get_annual_accrued_days(self.profile1, 2026, as_of=date(2026, 12, 31)), 21.0)

    def test_annual_accrual_starts_from_hire_month(self):
        from leaves.utils import get_annual_accrued_days

        self.profile1.hire_date = date(2026, 3, 20)
        self.profile1.save()

        self.assertEqual(get_annual_accrued_days(self.profile1, 2026, as_of=date(2026, 5, 17)), 5.25)

    def test_annual_remaining_uses_accrued_days_minus_usage(self):
        self.profile1.hire_date = date(2024, 1, 1)
        self.profile1.save()

        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual,
            start_date=date(2026, 3, 1),
            end_date=date(2026, 3, 2),
            status="approved",
            decided_by=self.hr,
        )

        from leaves.utils import calculate_leave_balance

        balances = calculate_leave_balance(self.emp1, 2026, as_of=date(2026, 5, 17))
        annual_bal = next(b for b in balances if b["leave_type_id"] == self.annual.id)
        self.assertEqual(float(annual_bal["used_days"]), 2.0)
        self.assertEqual(float(annual_bal["remaining_days"]), 6.75)

    def test_emergency_availability_uses_accrued_annual_balance(self):
        self.profile1.hire_date = date(2024, 1, 1)
        self.profile1.save()
        emergency = LeaveType.objects.create(name="Emergency Leave", code="EMERGENCY")

        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual,
            start_date=date(2026, 3, 1),
            end_date=date(2026, 3, 5),
            status="approved",
            decided_by=self.hr,
        )

        from leaves.utils import calculate_leave_balance

        balances = calculate_leave_balance(self.emp1, 2026, as_of=date(2026, 5, 17))
        emergency_bal = next(b for b in balances if b["leave_type_id"] == emergency.id)
        self.assertEqual(float(emergency_bal["remaining_days"]), 3.75)

    def test_balance_usage(self):
        year = date.today().year
        # Create Approved Request (2 days)
        start = date(year, 1, 10)
        end = date(year, 1, 11)
        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual,
            start_date=start,
            end_date=end,
            status="approved",
            decided_by=self.hr,
        )

        from leaves.utils import calculate_leave_balance

        balances = calculate_leave_balance(self.emp1, year, as_of=date(year, 12, 31))
        annual_bal = next(b for b in balances if b["leave_type_id"] == self.annual.id)

        # 21 - 2 = 19
        self.assertEqual(float(annual_bal["used_days"]), 2.0)
        self.assertEqual(float(annual_bal["remaining_days"]), 19.0)

    def test_annual_overflow_consumes_unpaid_balance(self):
        year = date.today().year
        start = date(year, 3, 1)
        end = date(year, 3, 30)
        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual,
            start_date=start,
            end_date=end,
            status="approved",
            decided_by=self.hr,
        )

        from leaves.utils import calculate_leave_balance

        balances = calculate_leave_balance(self.emp1, year, as_of=date(year, 12, 31))
        annual_bal = next(b for b in balances if b["leave_code"] == "ANNUAL")
        unpaid_bal = next(b for b in balances if b["leave_code"] == "UNPAID")

        self.assertEqual(float(annual_bal["remaining_days"]), 0.0)
        self.assertEqual(float(unpaid_bal["used_days"]), 9.0)
        self.assertEqual(float(unpaid_bal["remaining_days"]), 51.0)

    def test_annual_leave_request_can_fall_back_to_unpaid_balance(self):
        self.client.force_authenticate(user=self.emp1)
        year = date.today().year

        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual,
            start_date=date(year, 1, 1),
            end_date=date(year, 1, 21),
            status="approved",
            decided_by=self.hr,
        )

        start = date(year, 3, 1)
        end = date(year, 3, 5)
        response = self.client.post(
            "/api/leaves/leave-requests/",
            {"leave_type": self.annual.id, "start_date": str(start), "end_date": str(end), "reason": "Annual overflow"},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["payment_status"], "unpaid")

    def test_annual_leave_request_rejects_over_accrued_annual_plus_unpaid(self):
        self.client.force_authenticate(user=self.emp1)
        self.profile1.hire_date = date(2024, 1, 1)
        self.profile1.save()

        with patch("leaves.utils.date") as mocked_date:
            mocked_date.today.return_value = date(2026, 5, 17)
            mocked_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
            response = self.client.post(
                "/api/leaves/leave-requests/",
                {
                    "leave_type": self.annual.id,
                    "start_date": "2026-07-01",
                    "end_date": "2026-09-20",
                    "reason": "Beyond accrued annual plus unpaid",
                },
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Annual leave exceeds available balance", str(response.data))

    def test_carry_over_logic(self):
        year = date.today().year
        prev_year = year - 1

        # Set hire date to start of prev_year to avoid earlier carry-over
        self.profile1.hire_date = date(prev_year, 1, 1)
        self.profile1.save()
        self.emp1.refresh_from_db()  # Clear cached related objects like employee_profile

        # 1. Year-1: Use 2 days of Sick Leave (Quota 10) -> Remaining 8
        # Create approved request in prev_year
        start = date(prev_year, 5, 1)
        end = date(prev_year, 5, 2)
        LeaveRequest.objects.create(
            employee=self.emp1, leave_type=self.sick, start_date=start, end_date=end, status="approved"
        )

        # Verify Prev Year
        from leaves.utils import calculate_leave_balance

        prev_balances = calculate_leave_balance(self.emp1, prev_year)
        sick_prev = next(b for b in prev_balances if b["leave_type_id"] == self.sick.id)
        self.assertEqual(float(sick_prev["remaining_days"]), 8.0)

        # 2. Year: Opening should be min(8, max_carry_over=5) = 5
        curr_balances = calculate_leave_balance(self.emp1, year)
        sick_curr = next(b for b in curr_balances if b["leave_type_id"] == self.sick.id)

        # self.assertEqual(float(sick_curr["opening_balance"]), 5.0) # opening_balance is not in dict explicitly?
        # Check remaining instead: Opening(5) + Quota(10) - Used(0) = 15
        self.assertEqual(float(sick_curr["remaining_days"]), 15.0)

    def test_employee_balance_endpoint(self):
        self.client.force_authenticate(user=self.emp1)
        year = date.today().year

        response = self.client.get(f"/api/leaves/employee/leave-balance/?year={year}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        print(f"DEBUG_EMP_BAL: {response.data}")
        # Expect list of balances
        data = response.data["data"]
        # Match structure
        self.assertTrue(isinstance(data, list))
        annual = next(item for item in data if item["leave_type"] == "Annual Leave")
        self.assertIn("available_annual_year_days", annual)

    def test_employee_cannot_access_global_list(self):
        self.client.force_authenticate(user=self.emp1)
        response = self.client.get(f"/api/leaves/leave-balances/?employee_id={self.profile1.id}&year=2024")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_view_employee_balance(self):
        self.client.force_authenticate(user=self.hr)
        year = date.today().year

        response = self.client.get(f"/api/leaves/leave-balances/?employee_id={self.profile1.id}&year={year}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.data["data"]
        self.assertTrue(isinstance(data, list))
        self.assertTrue(any(item["leave_type"] == "Annual Leave" for item in data))
