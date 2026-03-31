from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from django.utils.translation import override
from rest_framework.test import APITestCase

from audit.models import AuditLog
from core.permissions import get_role
from core.responses import error
from core.services import (
    build_pending_approval_item,
    get_pending_approvals_for_role,
    get_pending_approvals_for_user,
    get_workflow_snapshot,
    sync_workflow,
)
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from core.models import DelegationRule
from leaves.models import LeaveRequest, LeaveType
from loans.models import LoanRequest


class RoleResolutionTests(TestCase):
    def test_get_role_returns_cfo_when_cfo_group_exists(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(email="cfo-role@test.com", password="password")
        cfo_group, _ = Group.objects.get_or_create(name="CFO")
        user.groups.add(cfo_group)

        self.assertEqual(get_role(user), "CFO")


class HrSummaryViewTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")

        self.hr_user = self.user_model.objects.create_user(
            email="hr@test.com",
            password="StrongPass123!",
            full_name="HR Manager",
        )
        self.hr_user.groups.add(self.hr_group)

        self.admin_user = self.user_model.objects.create_user(
            email="admin@test.com",
            password="StrongPass123!",
            full_name="System Admin",
        )
        self.admin_user.groups.add(self.admin_group)

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
        self.assertEqual(recent_activity[0]["employee"], "hr@test.com")
        self.assertEqual(recent_activity[0]["action"], "employee_imported")


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
