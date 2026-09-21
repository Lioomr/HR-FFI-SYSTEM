from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from assets.models import Asset, AssetAssignment
from audit.models import AuditLog
from core.models import RequestObligation
from core.services import BUSINESS_TRIP_CODE
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    COMMENT_REQUIRED_MESSAGE,
    NOT_CEO_APPROVABLE_MESSAGE,
    NOT_CEO_REJECTABLE_MESSAGE,
    OBLIGATIONS_BLOCKING_MESSAGE,
    SELF_DECISION_MESSAGE,
    LeaveTransitionError,
    apply_ceo_approval,
    apply_ceo_rejection,
)
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
CEO_REQUESTS_URL = "/api/leaves/ceo/leave-requests/"


class CEOLeaveDecisionTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.annual_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        self.business_trip_type, _ = LeaveType.objects.get_or_create(
            company=self.company,
            code=BUSINESS_TRIP_CODE,
            defaults={"name": "Business Trip", "is_active": True},
        )
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        ceo_group, _ = Group.objects.get_or_create(name="CEO")

        self.employee = self._user("ceo-decision-employee@example.com", "EMP-CEOD-1", is_saudi=True)
        self.ceo_user = self._user("ceo-decision-ceo@example.com", "EMP-CEOD-CEO")
        self.ceo_user.groups.add(ceo_group)
        self.hr_ceo_user = self._user("ceo-decision-hr-ceo@example.com", "EMP-CEOD-HRCEO")
        self.hr_ceo_user.groups.add(hr_group, ceo_group)

    def _user(self, email, employee_id, *, is_saudi=False):
        user = User.objects.create_user(email=email, password="password")
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            is_saudi=is_saudi,
        )
        return user

    def _user_in_company(self, company, email, employee_id, *, is_saudi=False):
        user = User.objects.create_user(email=email, password="password")
        EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            is_saudi=is_saudi,
        )
        return user

    def _leave(self, *, employee=None, leave_type=None, status=Status.PENDING_CEO, **fields):
        employee = employee or self.employee
        return LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            leave_type=leave_type or self.annual_type,
            start_date=date(2026, 12, 1),
            end_date=date(2026, 12, 3),
            status=status,
            **fields,
        )

    def _blocked_business_trip(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="CEO Decision Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
            must_return_before_travel=True,
        )
        AssetAssignment.objects.create(
            asset=asset,
            employee=self.employee.employee_profile,
            assigned_by=self.ceo_user,
            is_active=True,
        )
        return self._leave(leave_type=self.business_trip_type)

    # --- service: approval ---

    def test_approval_is_final_for_non_travel_leave(self):
        leave = self._leave()

        transition = apply_ceo_approval(leave, actor=self.ceo_user, note="Approved")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_CEO)
        self.assertEqual(leave.status, Status.APPROVED)
        self.assertEqual(leave.ceo_decision_by, self.ceo_user)
        self.assertIsNotNone(leave.ceo_decision_at)
        self.assertEqual(leave.ceo_decision_note, "Approved")

    def test_approval_of_non_saudi_travel_leave_moves_to_hr_completion(self):
        traveller = self._user("ceo-decision-traveller@example.com", "EMP-CEOD-2")
        leave = self._leave(employee=traveller, will_travel=True)

        apply_ceo_approval(leave, actor=self.ceo_user)

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR_COMPLETION)

    def test_approval_refuses_request_outside_ceo_stage(self):
        leave = self._leave(status=Status.PENDING_HR)

        with self.assertRaisesMessage(LeaveTransitionError, NOT_CEO_APPROVABLE_MESSAGE):
            apply_ceo_approval(leave, actor=self.ceo_user)

    def test_hr_manager_cannot_decide_own_leave_at_ceo_stage(self):
        leave = self._leave(employee=self.hr_ceo_user)

        with self.assertRaisesMessage(LeaveTransitionError, SELF_DECISION_MESSAGE):
            apply_ceo_approval(leave, actor=self.hr_ceo_user)
        with self.assertRaisesMessage(LeaveTransitionError, SELF_DECISION_MESSAGE):
            apply_ceo_rejection(leave, actor=self.hr_ceo_user, comment="No")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_CEO)

    def test_blocked_business_trip_is_refused_but_keeps_synced_obligations(self):
        leave = self._blocked_business_trip()

        with self.assertRaises(LeaveTransitionError) as caught:
            apply_ceo_approval(leave, actor=self.ceo_user)

        self.assertEqual(caught.exception.message, OBLIGATIONS_BLOCKING_MESSAGE)
        self.assertEqual(caught.exception.data["obligations_summary"]["blocking_open"], 1)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_CEO)
        self.assertTrue(
            RequestObligation.objects.filter(parent_object_id=leave.id, status=RequestObligation.Status.OPEN).exists()
        )

    def test_waiver_approves_blocked_business_trip_and_audits_waiver(self):
        leave = self._blocked_business_trip()

        apply_ceo_approval(leave, actor=self.ceo_user, waiver_reason="  Laptop needed on trip  ")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.APPROVED)
        obligation = RequestObligation.objects.get(
            parent_object_id=leave.id, type=RequestObligation.ObligationType.ASSET_RETURN
        )
        self.assertEqual(obligation.status, RequestObligation.Status.WAIVED)
        self.assertEqual(obligation.waiver_reason, "Laptop needed on trip")
        self.assertTrue(
            AuditLog.objects.filter(action="request_obligation_waived", entity_id=str(obligation.id)).exists()
        )

    # --- service: rejection ---

    def test_rejection_requires_comment(self):
        leave = self._leave()

        with self.assertRaisesMessage(LeaveTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_ceo_rejection(leave, actor=self.ceo_user, comment="")

    def test_rejection_refuses_request_outside_ceo_stage(self):
        leave = self._leave(status=Status.APPROVED)

        with self.assertRaisesMessage(LeaveTransitionError, NOT_CEO_REJECTABLE_MESSAGE):
            apply_ceo_rejection(leave, actor=self.ceo_user, comment="No")

    def test_rejection_records_ceo_decision(self):
        leave = self._leave()

        apply_ceo_rejection(leave, actor=self.ceo_user, comment="  Not this month ")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertEqual(leave.ceo_decision_by, self.ceo_user)
        self.assertEqual(leave.ceo_decision_note, "Not this month")

    # --- API ---

    @patch("leaves.views.notify_after_ceo_approval")
    def test_ceo_can_view_and_approve_an_explicitly_accessible_company(self, notify_approved):
        other_company = OrganizationNode.objects.create(
            code="CEO-ACCESS", name="CEO Accessible Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        UserOrganizationAccess.objects.create(user=self.ceo_user, organization=other_company)
        employee = self._user_in_company(other_company, "ceo-access-employee@example.com", "EMP-CEOD-ACCESS")
        leave_type = LeaveType.objects.create(
            company=other_company, name="Annual Leave", code="ANNUAL", is_active=True
        )
        leave = LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            leave_type=leave_type,
            start_date=date(2026, 12, 1),
            end_date=date(2026, 12, 3),
            status=Status.PENDING_CEO,
        )
        self.client.force_authenticate(user=self.ceo_user)
        headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(other_company.id)}

        detail = self.client.get(f"{CEO_REQUESTS_URL}{leave.id}/", **headers)
        approval = self.client.post(f"{CEO_REQUESTS_URL}{leave.id}/approve/", {"comment": "OK"}, format="json", **headers)

        self.assertEqual(detail.status_code, status.HTTP_200_OK, detail.data)
        self.assertEqual(approval.status_code, status.HTTP_200_OK, approval.data)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.APPROVED)
        notify_approved.assert_called_once()

    def test_ceo_cannot_view_a_company_without_explicit_access(self):
        foreign_company = OrganizationNode.objects.create(
            code="CEO-FOREIGN", name="CEO Foreign Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        employee = self._user_in_company(foreign_company, "ceo-foreign-employee@example.com", "EMP-CEOD-FOREIGN")
        leave_type = LeaveType.objects.create(
            company=foreign_company, name="Annual Leave", code="ANNUAL", is_active=True
        )
        leave = LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            leave_type=leave_type,
            start_date=date(2026, 12, 1),
            end_date=date(2026, 12, 3),
            status=Status.PENDING_CEO,
        )
        self.client.force_authenticate(user=self.ceo_user)

        response = self.client.get(
            f"{CEO_REQUESTS_URL}{leave.id}/", HTTP_X_ACTIVE_COMPANY_ID=str(foreign_company.id)
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_approve_endpoint_returns_obligations_summary_when_blocked(self):
        leave = self._blocked_business_trip()
        self.client.force_authenticate(user=self.ceo_user)

        response = self.client.post(f"{CEO_REQUESTS_URL}{leave.id}/approve/", {"comment": "OK"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["message"], OBLIGATIONS_BLOCKING_MESSAGE)
        self.assertEqual(response.data["errors"], [{"message": OBLIGATIONS_BLOCKING_MESSAGE}])
        self.assertEqual(response.data["data"]["obligations_summary"]["blocking_open"], 1)

    @patch("leaves.services.notify_leave_approved")
    def test_approve_endpoint_with_waiver_approves_and_notifies(self, notify_approved):
        leave = self._blocked_business_trip()
        self.client.force_authenticate(user=self.ceo_user)

        response = self.client.post(
            f"{CEO_REQUESTS_URL}{leave.id}/approve/",
            {"comment": "OK", "waiver_reason": "Approved exception"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.APPROVED)
        notify_approved.assert_called_once()
        audit_log = AuditLog.objects.filter(action="approve_ceo", entity_id=str(leave.id)).last()
        self.assertIs(audit_log.metadata["requires_hr_completion"], False)

    def test_reject_notification_failure_does_not_undo_decision(self):
        leave = self._leave()
        self.client.force_authenticate(user=self.ceo_user)

        with (
            self.assertLogs("leaves.services", level="ERROR") as logs,
            patch("leaves.services.notify_leave_rejected", side_effect=RuntimeError("provider down")),
        ):
            response = self.client.post(f"{CEO_REQUESTS_URL}{leave.id}/reject/", {"comment": "No"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertTrue(any("ceo_leave_rejection_notification_failed" in line for line in logs.output))
