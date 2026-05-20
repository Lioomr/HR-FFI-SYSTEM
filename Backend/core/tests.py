from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from django.utils.translation import override
from rest_framework.test import APITestCase

from assets.models import Asset, AssetReturnRequest
from attendance.models import AttendanceRecord
from audit.models import AuditLog
from core.models import DelegationRule, UserPreference
from core.permissions import get_role, is_department_ceo_approver_user
from core.responses import error
from core.services import (
    build_pending_approval_item,
    get_pending_approvals_for_role,
    get_pending_approvals_for_user,
    get_workflow_snapshot,
    sync_workflow,
)
from employees.models import EmployeeDeletionRequest, EmployeeProfile
from hr_reference.models import Department, Position
from leaves.models import LeaveRequest, LeaveType
from loans.models import LoanRequest
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company


class RoleResolutionTests(TestCase):
    def test_get_role_returns_cfo_when_cfo_group_exists(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(email="cfo-role@test.com", password="password")
        cfo_group, _ = Group.objects.get_or_create(name="CFO")
        user.groups.add(cfo_group)

        self.assertEqual(get_role(user), "CFO")

    def test_ceo_group_user_is_global_ceo_approver(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(email="ceo-role@test.com", password="password")
        ceo_group, _ = Group.objects.get_or_create(name="CEO")
        user.groups.add(ceo_group)

        self.assertTrue(is_department_ceo_approver_user(user))


class HrSummaryViewTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.company = get_default_company()
        self.department = Department.objects.create(code="HRSUM", name="HR Summary Department", company=self.company)
        self.position = Position.objects.create(code="HRSUMPOS", name="HR Summary Position", company=self.company)

        self.hr_user = self.user_model.objects.create_user(
            email="hr@test.com",
            password="StrongPass123!",
            full_name="HR Manager",
        )
        self.hr_user.groups.add(self.hr_group)
        EmployeeProfile.objects.create(
            user=self.hr_user,
            employee_id="EMP-HR-SUMMARY",
            full_name="HR Manager",
            basic_salary=Decimal("9000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
            company=self.company,
        )

        self.admin_user = self.user_model.objects.create_user(
            email="admin@test.com",
            password="StrongPass123!",
            full_name="System Admin",
        )
        self.admin_user.groups.add(self.admin_group)
        EmployeeProfile.objects.create(
            user=self.admin_user,
            employee_id="EMP-ADMIN-SUMMARY",
            full_name="System Admin",
            basic_salary=Decimal("9500.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 2),
            company=self.company,
        )

    def test_recent_activity_only_includes_hr_manager_activity(self):
        AuditLog.objects.create(
            actor=self.admin_user,
            action="invite_sent",
            entity="invite",
            entity_id="1",
        )
        AuditLog.objects.create(
            actor=self.hr_user,
            action="employee_imported",
            entity="employee",
            entity_id="2",
        )

        self.client.force_authenticate(user=self.hr_user)
        response = self.client.get("/api/hr/summary/")

        self.assertEqual(response.status_code, 200)
        recent_activity = response.data["data"]["recent_activity"]

        self.assertEqual(len(recent_activity), 1)
        self.assertEqual(recent_activity[0]["employee"], "HR Manager")
        self.assertEqual(recent_activity[0]["action"], "employee_imported")

    def test_summary_counts_are_scoped_to_active_company(self):
        other_company = (
            OrganizationNode.objects.exclude(id=self.company.id)
            .filter(node_type=OrganizationNode.NodeType.COMPANY)
            .first()
        )
        other_department = Department.objects.create(code="OTH", name="Other Department", company=other_company)
        other_position = Position.objects.create(code="OTHPOS", name="Other Position", company=other_company)

        EmployeeProfile.objects.create(
            employee_id="EMP-FFI-1",
            full_name="FFI Employee",
            basic_salary=Decimal("7000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 2, 1),
            company=self.company,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            employee_id="EMP-ATH-1",
            full_name="Athroya Employee",
            basic_salary=Decimal("7100.00"),
            department_ref=other_department,
            position_ref=other_position,
            hire_date=date(2024, 2, 2),
            company=other_company,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/hr/summary/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["total_employees"], 3)


class ErrorResponseTests(TestCase):
    def test_422_message_uses_first_validation_error(self):
        response = error(
            "Validation error",
            errors=[{"field": "employee_id", "message": "Employee Profile not found."}],
            status=422,
        )

        self.assertEqual(response.data["message"], "Employee Profile not found.")
        self.assertEqual(response.data["errors"][0]["message"], "Employee Profile not found.")

    def test_422_message_is_translated_for_arabic(self):
        with override("ar"):
            response = error(
                "Validation error",
                errors=[{"field": "employee_id", "message": "Employee Profile not found."}],
                status=422,
            )

        expected = "لم يتم العثور على ملف تعريف الموظف."
        self.assertEqual(response.data["message"], expected)
        self.assertEqual(response.data["errors"][0]["message"], expected)


class WorkflowSnapshotTests(TestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.department = Department.objects.create(code="OPS", name="Operations")
        self.position = Position.objects.create(code="ENG", name="Engineer")

        self.manager = self.user_model.objects.create_user(
            email="manager-workflow@test.com",
            password="StrongPass123!",
            full_name="Manager Workflow",
        )
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager,
            employee_id="EMP-MANAGER-WF",
            full_name="Manager Workflow",
            basic_salary=Decimal("12000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
        )
        self.employee = self.user_model.objects.create_user(
            email="employee-workflow@test.com",
            password="StrongPass123!",
            full_name="Employee Workflow",
        )
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee,
            employee_id="EMP-EMP-WF",
            full_name="Employee Workflow",
            basic_salary=Decimal("8000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2025, 1, 1),
            manager_profile=self.manager_profile,
        )
        self.hr_user = self.user_model.objects.create_user(
            email="hr-workflow@test.com",
            password="StrongPass123!",
            full_name="HR Workflow",
        )
        self.hr_user.groups.add(self.hr_group)
        EmployeeProfile.objects.create(
            user=self.hr_user,
            employee_id="EMP-HR-WF",
            full_name="HR Workflow",
            basic_salary=Decimal("10000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
        )
        self.delegate_user = self.user_model.objects.create_user(
            email="delegate-workflow@test.com",
            password="StrongPass123!",
            full_name="Delegate Workflow",
        )
        EmployeeProfile.objects.create(
            user=self.delegate_user,
            employee_id="EMP-DEL-WF",
            full_name="Delegate Workflow",
            basic_salary=Decimal("9000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 6, 1),
        )

    def test_leave_snapshot_exposes_current_stage_and_history(self):
        leave_type = LeaveType.objects.create(name="Annual Leave", code="ANNUAL", is_active=True)
        request_obj = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=leave_type,
            start_date=date(2026, 3, 20),
            end_date=date(2026, 3, 22),
            reason="Family trip",
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        snapshot = get_workflow_snapshot(request_obj, actor=self.manager)

        self.assertEqual(snapshot["status"], "in_review")
        self.assertEqual(snapshot["current_stage"], "manager")
        self.assertEqual(snapshot["current_approver_role"], "manager")
        self.assertTrue(snapshot["can_approve"])
        self.assertEqual(len(snapshot["history"]), 1)
        self.assertEqual(snapshot["history"][0]["action"], "submit")

    def test_hr_pending_approvals_include_loan_items(self):
        loan_request = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1500.00"),
            reason="Emergency",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )

        sync_workflow(loan_request, actor=self.hr_user)
        pending = get_pending_approvals_for_role("hr", limit=10)
        workflow = next(item for item in pending if item.object_id == loan_request.id)
        card = build_pending_approval_item(workflow)

        self.assertIsNotNone(card)
        self.assertEqual(card["request_type"], "LOAN")
        self.assertEqual(card["review_path"], f"/hr/loan-requests/{loan_request.id}")

    def test_delegated_manager_becomes_current_actor_and_sees_pending_item(self):
        leave_type = LeaveType.objects.create(name="Annual Leave", code="ANNUAL", is_active=True)
        DelegationRule.objects.create(
            from_user=self.manager,
            to_user=self.delegate_user,
            start_at=timezone.now(),
            created_by=self.manager,
        )
        request_obj = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=leave_type,
            start_date=date(2026, 3, 20),
            end_date=date(2026, 3, 22),
            reason="Delegated review",
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        snapshot = get_workflow_snapshot(request_obj, actor=self.delegate_user)

        self.assertEqual(snapshot["current_actor"]["id"], self.delegate_user.id)
        self.assertTrue(snapshot["can_approve"])

        pending = get_pending_approvals_for_user(self.delegate_user, limit=10)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].object_id, request_obj.id)

    def test_delegated_hr_sees_pending_role_item_and_can_approve(self):
        DelegationRule.objects.create(
            from_user=self.hr_user,
            to_user=self.delegate_user,
            start_at=timezone.now(),
            created_by=self.hr_user,
        )
        loan_request = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1800.00"),
            reason="Delegated HR review",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )

        snapshot = get_workflow_snapshot(loan_request, actor=self.delegate_user)

        self.assertEqual(snapshot["current_actor"]["id"], self.delegate_user.id)
        self.assertTrue(snapshot["can_approve"])

        pending = get_pending_approvals_for_user(self.delegate_user, limit=10)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].object_id, loan_request.id)


class PendingRequestsApiTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.ceo_group, _ = Group.objects.get_or_create(name="CEO")
        self.company = get_default_company()
        self.other_company = OrganizationNode.objects.exclude(id=self.company.id).filter(
            node_type=OrganizationNode.NodeType.COMPANY
        ).first()
        self.department = Department.objects.create(code="PEND", name="Pending Department", company=self.company)
        self.position = Position.objects.create(code="PENDPOS", name="Pending Position", company=self.company)
        self.other_department = Department.objects.create(
            code="PENDOTH",
            name="Pending Other Department",
            company=self.other_company,
        )
        self.other_position = Position.objects.create(
            code="PENDOTHPOS",
            name="Pending Other Position",
            company=self.other_company,
        )

        self.hr_user = self.user_model.objects.create_user(
            email="pending-hr@test.com",
            password="StrongPass123!",
            full_name="Pending HR",
        )
        self.hr_user.groups.add(self.hr_group)
        EmployeeProfile.objects.create(
            user=self.hr_user,
            employee_id="EMP-PENDING-HR",
            full_name="Pending HR",
            basic_salary=Decimal("10000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
            company=self.company,
        )
        self.other_hr_user = self.user_model.objects.create_user(
            email="pending-other-hr@test.com",
            password="StrongPass123!",
            full_name="Other Pending HR",
        )
        self.other_hr_user.groups.add(self.hr_group)
        EmployeeProfile.objects.create(
            user=self.other_hr_user,
            employee_id="EMP-PENDING-OTHER-HR",
            full_name="Other Pending HR",
            basic_salary=Decimal("10000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
            company=self.company,
        )

        self.ceo_user = self.user_model.objects.create_user(
            email="pending-ceo@test.com",
            password="StrongPass123!",
            full_name="Pending CEO",
        )
        self.ceo_user.groups.add(self.ceo_group)
        EmployeeProfile.objects.create(
            user=self.ceo_user,
            employee_id="EMP-PENDING-CEO",
            full_name="Pending CEO",
            basic_salary=Decimal("15000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
            company=self.company,
        )

        self.manager_user = self.user_model.objects.create_user(
            email="pending-manager@test.com",
            password="StrongPass123!",
            full_name="Pending Manager",
        )
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="EMP-PENDING-MGR",
            full_name="Pending Manager",
            basic_salary=Decimal("12000.00"),
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2024, 1, 1),
            company=self.company,
        )

        self.employee = self.user_model.objects.create_user(
            email="pending-employee@test.com",
            password="StrongPass123!",
            full_name="Pending Employee",
        )
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee,
            employee_id="EMP-PENDING-EMP",
            full_name="Pending Employee",
            basic_salary=Decimal("7000.00"),
            department_ref=self.department,
            position_ref=self.position,
            manager_profile=self.manager_profile,
            hire_date=date(2024, 1, 1),
            company=self.company,
        )
        self.leave_type = LeaveType.objects.create(name="Annual Leave Pending", code="PEND_ANNUAL", company=self.company)

    def _create_hr_pending_requests(self):
        LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2026, 5, 20),
            end_date=date(2026, 5, 22),
            reason="Annual leave",
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )
        LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            requested_amount=Decimal("2500.00"),
            reason="School fees",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )
        AttendanceRecord.objects.create(
            employee_profile=self.employee_profile,
            date=date(2026, 5, 7),
            status=AttendanceRecord.Status.PENDING_HR,
            source=AttendanceRecord.Source.EMPLOYEE,
        )
        asset = Asset.objects.create(
            company=self.company,
            name_en="Pending Laptop",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"kind": "laptop"},
        )
        AssetReturnRequest.objects.create(
            asset=asset,
            employee=self.employee_profile,
            note="Returning asset",
            status=AssetReturnRequest.RequestStatus.PENDING,
        )

    def test_hr_pending_requests_include_all_hr_workflow_types_and_filters(self):
        self._create_hr_pending_requests()
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        items = response.data["data"]["items"]
        self.assertEqual({item["request_type"] for item in items}, {"LEAVE", "LOAN", "ATTENDANCE", "ASSET"})
        self.assertTrue(all(item["current_approver_role"] == "hr" for item in items))
        self.assertTrue(all("workflow_id" in item for item in items))

        loan_response = self.client.get(
            "/api/core/pending-requests/",
            {"request_type": "LOAN"},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        self.assertEqual([item["request_type"] for item in loan_response.data["data"]["items"]], ["LOAN"])

        search_response = self.client.get(
            "/api/core/pending-requests/",
            {"search": "school"},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        self.assertEqual([item["request_type"] for item in search_response.data["data"]["items"]], ["LOAN"])

    def test_pending_request_time_uses_request_submission_timestamp(self):
        leave = LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2026, 5, 20),
            end_date=date(2026, 5, 22),
            reason="Old annual leave",
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )
        submitted_at = timezone.datetime(2026, 5, 7, 8, 30, tzinfo=timezone.get_current_timezone())
        LeaveRequest.objects.filter(pk=leave.pk).update(created_at=submitted_at)
        leave.refresh_from_db()
        sync_workflow(leave)
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        [item] = response.data["data"]["items"]
        self.assertEqual(item["request_type"], "LEAVE")
        self.assertTrue(item["time"].startswith("2026-05-07T08:30:00"))

    def test_ceo_pending_requests_include_employee_deletion(self):
        EmployeeDeletionRequest.objects.create(
            company=self.company,
            employee_profile=self.employee_profile,
            target_user=self.employee,
            requested_by=self.hr_user,
            reason="Duplicate profile",
            status=EmployeeDeletionRequest.Status.PENDING_CEO,
            request_snapshot={"full_name": "Pending Employee", "employee_id": "EMP-PENDING-EMP"},
        )
        self.client.force_authenticate(user=self.ceo_user)

        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["request_type"], "EMPLOYEE_DELETION")
        self.assertEqual(items[0]["review_path"], f"/ceo/employees/deletion-requests/{items[0]['id']}")

    def test_manager_sees_only_direct_actionable_requests(self):
        LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2026, 5, 20),
            end_date=date(2026, 5, 22),
            reason="Manager review",
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )
        LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            requested_amount=Decimal("2500.00"),
            reason="HR only",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )
        self.client.force_authenticate(user=self.manager_user)

        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["request_type"], "LEAVE")
        self.assertEqual(items[0]["current_approver_role"], "manager")

    def test_pending_requests_are_scoped_to_active_company(self):
        self._create_hr_pending_requests()
        other_employee = self.user_model.objects.create_user(
            email="pending-other@test.com",
            password="StrongPass123!",
            full_name="Other Company Employee",
        )
        other_profile = EmployeeProfile.objects.create(
            user=other_employee,
            employee_id="EMP-PENDING-OTHER",
            full_name="Other Company Employee",
            basic_salary=Decimal("7000.00"),
            department_ref=self.other_department,
            position_ref=self.other_position,
            hire_date=date(2024, 1, 1),
            company=self.other_company,
        )
        LoanRequest.objects.create(
            employee=other_employee,
            employee_profile=other_profile,
            company=self.other_company,
            requested_amount=Decimal("9999.00"),
            reason="Other company loan",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["count"], 4)
        self.assertNotIn("Other company loan", [item["action"] for item in response.data["data"]["items"]])

        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.other_company)
        head_office = OrganizationNode.objects.get(node_type=OrganizationNode.NodeType.HEAD_OFFICE)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=head_office)
        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(head_office.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["count"], 5)
        self.assertIn(self.other_company.name, {item["company_name"] for item in response.data["data"]["items"]})

    def test_pending_requests_resync_clears_stale_single_hr_assignment(self):
        loan_request = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            requested_amount=Decimal("2750.00"),
            reason="Stale HR assignment",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )
        workflow = sync_workflow(loan_request, actor=self.hr_user)
        workflow.current_actor_user = self.hr_user
        workflow.save(update_fields=["current_actor_user", "updated_at"])

        self.client.force_authenticate(user=self.other_hr_user)
        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        items = response.data["data"]["items"]
        self.assertIn(loan_request.id, [item["id"] for item in items if item["request_type"] == "LOAN"])

        workflow.refresh_from_db()
        self.assertIsNone(workflow.current_actor_user_id)
        self.assertEqual(workflow.current_approver_role, "hr")

    def test_pending_requests_exclude_completed_requests_with_stale_workflow(self):
        loan_request = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            requested_amount=Decimal("3000.00"),
            reason="Completed request",
            status=LoanRequest.RequestStatus.PENDING_HR,
        )
        workflow = sync_workflow(loan_request, actor=self.hr_user)
        LoanRequest.objects.filter(pk=loan_request.pk).update(status=LoanRequest.RequestStatus.APPROVED)
        workflow.status = "in_review"
        workflow.current_approver_role = "hr"
        workflow.save(update_fields=["status", "current_approver_role", "updated_at"])

        self.client.force_authenticate(user=self.hr_user)
        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        items = response.data["data"]["items"]
        self.assertNotIn(loan_request.id, [item["id"] for item in items if item["request_type"] == "LOAN"])

    def test_pending_requests_syncs_more_than_default_legacy_limit(self):
        for index in range(105):
            LeaveRequest.objects.create(
                employee=self.employee,
                employee_profile=self.employee_profile,
                company=self.company,
                leave_type=self.leave_type,
                start_date=date(2026, 6, 1),
                end_date=date(2026, 6, 2),
                reason=f"Bulk pending leave {index}",
                status=LeaveRequest.RequestStatus.PENDING_HR,
            )

        self.client.force_authenticate(user=self.hr_user)
        response = self.client.get("/api/core/pending-requests/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["count"], 105)


class DelegationRuleApiTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.department = Department.objects.create(code="ADM", name="Administration")
        self.position = Position.objects.create(code="SUP", name="Supervisor")

        self.hr_user = self.user_model.objects.create_user(
            email="delegation-hr@test.com",
            password="StrongPass123!",
            full_name="Delegation HR",
        )
        self.hr_user.groups.add(self.hr_group)

        self.manager = self.user_model.objects.create_user(
            email="delegation-manager@test.com",
            password="StrongPass123!",
            full_name="Delegation Manager",
        )
        self.delegate = self.user_model.objects.create_user(
            email="delegation-target@test.com",
            password="StrongPass123!",
            full_name="Delegation Target",
        )
        for idx, user in enumerate([self.hr_user, self.manager, self.delegate], start=1):
            EmployeeProfile.objects.create(
                user=user,
                employee_id=f"EMP-DEL-{idx}",
                full_name=user.full_name,
                basic_salary=Decimal("7000.00"),
                department_ref=self.department,
                position_ref=self.position,
                hire_date=date(2024, 1, idx),
            )

    def test_manager_can_create_own_delegation_rule(self):
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(
            "/api/core/workflow/delegations/",
            {
                "from_user_id": self.manager.id,
                "to_user_id": self.delegate.id,
                "start_at": "2026-03-13T09:00:00Z",
                "end_at": "2026-03-20T09:00:00Z",
                "reason": "Annual leave coverage",
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["data"]["from_user"]["id"], self.manager.id)
        self.assertEqual(response.data["data"]["to_user"]["id"], self.delegate.id)
        self.assertEqual(DelegationRule.objects.count(), 1)

    def test_manager_cannot_create_delegation_for_another_user(self):
        self.client.force_authenticate(user=self.manager)
        other_user = self.user_model.objects.create_user(
            email="another-user@test.com",
            password="StrongPass123!",
            full_name="Another User",
        )

        response = self.client.post(
            "/api/core/workflow/delegations/",
            {
                "from_user_id": other_user.id,
                "to_user_id": self.delegate.id,
                "start_at": "2026-03-13T09:00:00Z",
                "reason": "Unauthorized",
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_hr_can_list_all_delegation_rules(self):
        DelegationRule.objects.create(
            from_user=self.manager,
            to_user=self.delegate,
            start_at=timezone.now(),
            created_by=self.hr_user,
        )
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.get("/api/core/workflow/delegations/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["data"]["items"]), 1)


class UserPreferenceApiTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            email="prefs@test.com",
            password="StrongPass123!",
            full_name="Prefs User",
        )

    def test_get_missing_preference_returns_empty_value(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.get("/api/core/preferences/tables/hr-employees-list/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["scope"], "tables")
        self.assertEqual(response.data["data"]["key"], "hr-employees-list")
        self.assertEqual(response.data["data"]["value"], {})

    def test_put_preference_upserts_and_audits(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.put(
            "/api/core/preferences/tables/hr-employees-list/",
            {
                "value": {
                    "search": "saudi",
                    "pageSize": 50,
                    "visibleColumns": ["full_name", "department"],
                }
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        preference = UserPreference.objects.get(user=self.user, scope="tables", key="hr-employees-list")
        self.assertEqual(preference.value["pageSize"], 50)
        self.assertTrue(AuditLog.objects.filter(action="user_preference_saved", entity_id=preference.id).exists())
