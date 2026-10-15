"""Employee cancellation requests for approved requests, decided by HR (Phase 3)."""

from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from assets.models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest
from attendance.models import AttendanceAdjustment
from audit.models import AuditLog
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from employees.models import EmployeeProfile
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from loans.models import LoanRequest
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company
from permission_requests.models import PermissionRequest
from permission_requests.services import _upsert_attendance_adjustment
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import CancellationRequest, WorkflowAction
from core.services.cancellation_requests import (
    ALREADY_DECIDED_MESSAGE,
    LEAVE_ENDED_MESSAGE,
    LEAVE_MANUAL_MESSAGE,
    LOAN_DISBURSED_MESSAGE,
    LOAN_NOT_AWAITING_DISBURSEMENT_MESSAGE,
    NO_PENDING_REQUEST_MESSAGE,
    NOT_APPROVED_MESSAGE,
    OPEN_REQUEST_EXISTS_MESSAGE,
    PERMISSION_PAST_MESSAGE,
    RETURN_PROCESSED_MESSAGE,
    SELF_DECISION_MESSAGE,
    SETTLEMENT_NOT_OWN_MESSAGE,
    SETTLEMENT_PAYOUT_UNVERIFIED_MESSAGE,
)
from core.services.workflow_engine import get_workflow_snapshot, get_workflow_snapshots

User = get_user_model()
Action = WorkflowAction.Action
LeaveStatus = LeaveRequest.RequestStatus
CR_URL = "/api/core/cancellation-requests/"
DISPATCH = "in_app_notifications.dispatcher.dispatch_notification_channels"


class CancellationRequestTestBase(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee = self._user("cr-employee@example.com", "EMP-CRQ-1")
        self.colleague = self._user("cr-colleague@example.com", "EMP-CRQ-2")
        self.hr_user = self._user("cr-hr@example.com", "EMP-CRQ-HR1", hr=True)
        self.other_hr = self._user("cr-hr2@example.com", "EMP-CRQ-HR2", hr=True)
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        self.today = timezone.localdate()

    def _user(self, email, employee_id, *, hr=False, company=None):
        company = company or self.company
        user = User.objects.create_user(email=email, password="password", full_name=email.split("@")[0])
        user.groups.add(self.hr_group if hr else self.employee_group)
        if hr:
            UserOrganizationAccess.objects.create(user=user, organization=company)
        EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        return user

    def _client(self, user, company=None):
        self.client.force_authenticate(user=user)
        self.client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).pk))
        return self.client

    def _post(self, path, user=None, data=None, company=None):
        return self._client(user or self.employee, company).post(path, data or {}, format="json")

    def _actions(self, obj, action=None):
        queryset = WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(obj.__class__), workflow__object_id=obj.pk
        ).order_by("created_at", "id")
        return queryset.filter(action=action) if action else queryset

    # Request factories ------------------------------------------------------

    def _leave(self, *, employee=None, status=LeaveStatus.APPROVED, start=None, end=None, **fields):
        employee = employee or self.employee
        start = start or self.today + timedelta(days=5)
        company = employee.employee_profile.company
        leave_type = (
            self.leave_type
            if company == self.company
            else LeaveType.objects.get_or_create(
                company=company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
            )[0]
        )
        return LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            company=company,
            leave_type=leave_type,
            start_date=start,
            end_date=end or start + timedelta(days=2),
            status=status,
            **fields,
        )

    def _permission(self, *, status=PermissionRequest.Status.APPROVED, request_date=None, number=1):
        profile = self.employee.employee_profile
        return PermissionRequest.objects.create(
            employee=self.employee,
            employee_profile=profile,
            company=profile.company,
            reference_no=f"PERM-CRQ-{number:04d}",
            request_date=request_date or self.today,
            from_time=time(9, 0),
            to_time=time(10, 0),
            duration_minutes=60,
            exit_type=PermissionRequest.ExitType.PERSONAL,
            reason="Doctor visit",
            status=status,
        )

    def _asset(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="CR Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
        )
        AssetAssignment.objects.create(
            asset=asset, employee=self.employee.employee_profile, assigned_by=self.hr_user, is_active=True
        )
        return asset

    def _settlement(self, *, status=AnnualLeavePaymentRequest.Status.APPROVED, submitted_by=None, **fields):
        return AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            cycle_start=date(2026, 1, 1),
            cycle_end=date(2026, 12, 31),
            eligible_unused_days=Decimal("10.00"),
            payment_amount=Decimal("1000.00"),
            submitted_by=submitted_by or self.employee,
            status=status,
            **fields,
        )

    def _loan(self, status=LoanRequest.RequestStatus.PENDING_DISBURSEMENT):
        profile = self.employee.employee_profile
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=profile,
            company=self.company,
            requested_amount=Decimal("2000.00"),
            approved_amount=Decimal("2000.00"),
            status=status,
        )

    def _request_cancellation(self, path, reason="My plans changed", user=None):
        return self._post(f"{path}request-cancellation/", user=user, data={"reason": reason})


class LeaveCancellationRequestTests(CancellationRequestTestBase):
    def _path(self, leave):
        return f"/api/leaves/leave-requests/{leave.id}/"

    def test_owner_requests_and_withdraws_with_flags_and_history(self):
        leave = self._leave()
        self.assertTrue(get_workflow_snapshot(leave, actor=self.employee)["can_request_cancellation"])
        for viewer in (self.colleague, self.hr_user):
            snapshot = get_workflow_snapshot(leave, actor=viewer)
            self.assertFalse(snapshot["can_request_cancellation"])
            self.assertFalse(snapshot["can_withdraw_cancellation_request"])

        response = self._request_cancellation(self._path(leave), reason="  Family plans changed  ")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        data = response.data["data"]
        self.assertEqual(data["status"], LeaveStatus.APPROVED)
        workflow = data["workflow"]
        self.assertEqual(workflow["status"], "approved")
        self.assertFalse(workflow["can_request_cancellation"])
        self.assertTrue(workflow["can_withdraw_cancellation_request"])
        self.assertFalse(workflow["can_cancel"])
        self.assertFalse(workflow["can_edit"])
        self.assertEqual(workflow["cancellation_request"]["status"], "pending")
        self.assertEqual(workflow["cancellation_request"]["reason"], "Family plans changed")
        self.assertIsNone(workflow["cancellation_request"]["decided_by_name"])
        self.assertEqual(workflow["history"][-1]["action"], "cancellation_requested")
        self.assertEqual(workflow["history"][-1]["note"], "Family plans changed")
        self.assertEqual(workflow["history"][-1]["to_status"], "approved")
        audit_row = AuditLog.objects.filter(action="cancellation_requested", entity_id=str(leave.id)).get()
        self.assertEqual(audit_row.metadata["kind"], "leave")
        self.assertEqual(audit_row.metadata["from_status"], LeaveStatus.APPROVED)
        self.assertNotIn("reason", audit_row.metadata)

        duplicate = self._request_cancellation(self._path(leave))
        self.assertEqual(duplicate.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(duplicate.data["errors"], [OPEN_REQUEST_EXISTS_MESSAGE])

        # Nobody but the owner can withdraw it.
        self.assertEqual(
            self._post(f"{self._path(leave)}withdraw-cancellation-request/", user=self.colleague).status_code, 404
        )
        withdrawn = self._post(f"{self._path(leave)}withdraw-cancellation-request/")
        self.assertEqual(withdrawn.status_code, status.HTTP_200_OK, withdrawn.data)
        workflow = withdrawn.data["data"]["workflow"]
        self.assertEqual(workflow["cancellation_request"]["status"], "withdrawn")
        self.assertTrue(workflow["can_request_cancellation"])
        self.assertFalse(workflow["can_withdraw_cancellation_request"])
        self.assertEqual(workflow["history"][-1]["action"], "cancellation_withdrawn")
        self.assertTrue(AuditLog.objects.filter(action="cancellation_withdrawn", entity_id=str(leave.id)).exists())

        again = self._post(f"{self._path(leave)}withdraw-cancellation-request/")
        self.assertEqual(again.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(again.data["errors"], [NO_PENDING_REQUEST_MESSAGE])
        leave.refresh_from_db()
        self.assertEqual(leave.status, LeaveStatus.APPROVED)

    def test_ineligible_leave_requests_are_refused(self):
        cases = [
            (
                self._leave(start=self.today - timedelta(days=5), end=self.today - timedelta(days=1)),
                LEAVE_ENDED_MESSAGE,
            ),
            (self._leave(status=LeaveStatus.PENDING_HR), NOT_APPROVED_MESSAGE),
            (self._leave(status=LeaveStatus.REJECTED), NOT_APPROVED_MESSAGE),
            (self._leave(status=LeaveStatus.CANCELLED), NOT_APPROVED_MESSAGE),
            (self._leave(source=LeaveRequest.RequestSource.HR_MANUAL), LEAVE_MANUAL_MESSAGE),
        ]
        for leave, message in cases:
            with self.subTest(status=leave.status, message=message):
                self.assertFalse(get_workflow_snapshot(leave, actor=self.employee)["can_request_cancellation"])
                response = self._request_cancellation(self._path(leave))
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"], [message])
        # A leave ending today can still be withdrawn.
        today_leave = self._leave(start=self.today - timedelta(days=1), end=self.today)
        self.assertEqual(self._request_cancellation(self._path(today_leave)).status_code, 201)
        self.assertEqual(CancellationRequest.objects.count(), 1)

    def test_non_owner_gets_not_found(self):
        leave = self._leave()
        for user in (self.colleague, self.hr_user):
            with self.subTest(user=user.email):
                self.assertEqual(self._request_cancellation(self._path(leave), user=user).status_code, 404)
        self.assertEqual(self._request_cancellation("/api/leaves/leave-requests/999999/").status_code, 404)
        self.assertFalse(CancellationRequest.objects.exists())

    def test_reason_is_required_and_bounded(self):
        leave = self._leave()
        for reason in (None, "", "    ", "abc", "x" * 1001, 123):
            with self.subTest(reason=reason):
                data = {} if reason is None else {"reason": reason}
                response = self._post(f"{self._path(leave)}request-cancellation/", data=data)
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"][0]["field"], "reason")
        self.assertEqual(self._request_cancellation(self._path(leave), reason="x" * 1000).status_code, 201)

    def test_hr_confirm_cancels_the_leave_and_notifies(self):
        leave = self._leave()
        with patch(DISPATCH) as dispatch, self.captureOnCommitCallbacks(execute=True):
            self._request_cancellation(self._path(leave))
        hr_recipients = {call.kwargs["recipient"] for call in dispatch.call_args_list}
        self.assertEqual(hr_recipients, {self.hr_user, self.other_hr})
        call = dispatch.call_args_list[0].kwargs
        self.assertEqual(call["event_key"], "cancellation.requested")
        self.assertEqual(call["action_url"], f"/hr/leave/requests/{leave.id}")
        self.assertFalse(call["whatsapp_enabled"])
        self.assertEqual(call["i18n"]["key"], "cancellation.requested")

        row = CancellationRequest.objects.get()
        listing = self._client(self.hr_user).get(CR_URL)
        self.assertEqual(listing.status_code, 200, listing.data)
        item = listing.data["data"]["items"][0]
        self.assertEqual(
            (item["id"], item["kind"], item["request_id"], item["status"], item["request_status"]),
            (row.id, "leave", leave.id, "pending", LeaveStatus.APPROVED),
        )
        self.assertEqual(item["detail_path"], f"/hr/leave/requests/{leave.id}")
        self.assertEqual(item["reason"], "My plans changed")
        self.assertTrue(item["can_decide"])
        self.assertIn("employee_name", item)
        self.assertIn("request_title", item)
        self.assertIn("reference_no", item)

        with patch(DISPATCH) as dispatch, self.captureOnCommitCallbacks(execute=True):
            response = self._post(f"{CR_URL}{row.id}/confirm/", user=self.hr_user, data={"comment": "Approved by HR"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"]["status"], "confirmed")
        self.assertEqual(response.data["data"]["request_status"], LeaveStatus.CANCELLED)
        self.assertEqual(response.data["data"]["decision_note"], "Approved by HR")
        self.assertFalse(response.data["data"]["can_decide"])
        leave.refresh_from_db()
        self.assertEqual(leave.status, LeaveStatus.CANCELLED)
        cancel = self._actions(leave, Action.CANCEL).get()
        self.assertEqual((cancel.actor, cancel.note, cancel.approver_role), (self.hr_user, "Approved by HR", "hr"))
        self.assertEqual((cancel.from_status, cancel.to_status), ("approved", "cancelled"))
        self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(dispatch.call_args.kwargs["recipient"], self.employee)
        self.assertEqual(dispatch.call_args.kwargs["event_key"], "cancellation.confirmed")
        audit_row = AuditLog.objects.filter(action="cancellation_confirmed", entity_id=str(leave.id)).get()
        self.assertEqual(
            (audit_row.metadata["from_status"], audit_row.metadata["to_status"]), ("approved", "cancelled")
        )

        snapshot = get_workflow_snapshot(leave, actor=self.employee)
        self.assertEqual(snapshot["cancellation_request"]["status"], "confirmed")
        self.assertFalse(snapshot["can_request_cancellation"])

        again = self._post(f"{CR_URL}{row.id}/confirm/", user=self.other_hr)
        self.assertEqual(again.status_code, 422)
        self.assertEqual(again.data["errors"], [ALREADY_DECIDED_MESSAGE])

    def test_hr_confirm_without_comment_uses_a_default_note(self):
        leave = self._leave()
        self._request_cancellation(self._path(leave))
        row = CancellationRequest.objects.get()
        self.assertEqual(self._post(f"{CR_URL}{row.id}/confirm/", user=self.hr_user).status_code, 200)
        self.assertTrue(self._actions(leave, Action.CANCEL).get().note)

    def test_hr_decline_keeps_the_leave_approved_and_allows_a_new_request(self):
        leave = self._leave()
        self._request_cancellation(self._path(leave))
        row = CancellationRequest.objects.get()

        missing = self._post(f"{CR_URL}{row.id}/decline/", user=self.hr_user, data={"comment": "  "})
        self.assertEqual(missing.status_code, 422)
        self.assertEqual(missing.data["errors"][0]["field"], "comment")

        with patch(DISPATCH) as dispatch, self.captureOnCommitCallbacks(execute=True):
            response = self._post(
                f"{CR_URL}{row.id}/decline/", user=self.hr_user, data={"comment": "Team is short-staffed"}
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"]["status"], "declined")
        self.assertEqual(dispatch.call_args.kwargs["event_key"], "cancellation.declined")
        self.assertEqual(dispatch.call_args.kwargs["recipient"], self.employee)
        leave.refresh_from_db()
        self.assertEqual(leave.status, LeaveStatus.APPROVED)
        declined = self._actions(leave, Action.CANCELLATION_DECLINED).get()
        self.assertEqual((declined.actor, declined.note), (self.hr_user, "Team is short-staffed"))
        self.assertFalse(self._actions(leave, Action.CANCEL).exists())

        detail = self._client(self.employee).get(self._path(leave))
        workflow = detail.data["data"]["workflow"]
        self.assertEqual(workflow["cancellation_request"]["status"], "declined")
        self.assertEqual(workflow["cancellation_request"]["decision_note"], "Team is short-staffed")
        self.assertTrue(workflow["cancellation_request"]["decided_by_name"])
        self.assertTrue(workflow["can_request_cancellation"])
        self.assertEqual(self._request_cancellation(self._path(leave)).status_code, 201)
        self.assertEqual(CancellationRequest.objects.filter(object_id=leave.id).count(), 2)

    def test_hr_member_cannot_decide_their_own_request(self):
        leave = self._leave(employee=self.hr_user)
        self.assertEqual(self._request_cancellation(self._path(leave), user=self.hr_user).status_code, 201)
        row = CancellationRequest.objects.get()

        listing = self._client(self.hr_user).get(CR_URL)
        self.assertFalse(listing.data["data"]["items"][0]["can_decide"])
        for decision in ("confirm", "decline"):
            with self.subTest(decision=decision):
                response = self._post(f"{CR_URL}{row.id}/{decision}/", user=self.hr_user, data={"comment": "Mine"})
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.data["errors"], [SELF_DECISION_MESSAGE])
        self.assertEqual(self._post(f"{CR_URL}{row.id}/confirm/", user=self.other_hr).status_code, 200)
        leave.refresh_from_db()
        self.assertEqual(leave.status, LeaveStatus.CANCELLED)

    def test_confirm_rechecks_eligibility(self):
        leave = self._leave()
        self._request_cancellation(self._path(leave))
        row = CancellationRequest.objects.get()
        # A change that bypasses the HR cancel service leaves the row open.
        LeaveRequest.objects.filter(pk=leave.pk).update(status=LeaveStatus.REJECTED)

        response = self._post(f"{CR_URL}{row.id}/confirm/", user=self.hr_user)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["errors"], [NOT_APPROVED_MESSAGE])
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")
        # The stale request can still be closed.
        closed = self._post(f"{CR_URL}{row.id}/decline/", user=self.hr_user, data={"comment": "Already cancelled"})
        self.assertEqual(closed.status_code, 200)

    def test_confirm_refused_once_the_leave_has_ended(self):
        leave = self._leave()
        self._request_cancellation(self._path(leave))
        LeaveRequest.objects.filter(pk=leave.pk).update(
            start_date=self.today - timedelta(days=3), end_date=self.today - timedelta(days=1)
        )
        response = self._post(f"{CR_URL}{CancellationRequest.objects.get().id}/confirm/", user=self.hr_user)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["errors"], [LEAVE_ENDED_MESSAGE])

    def test_direct_hr_cancel_closes_the_pending_cancellation_request(self):
        leave = self._leave()
        self._request_cancellation(self._path(leave))
        row = CancellationRequest.objects.get()
        self.assertEqual(row.status, CancellationRequest.Status.PENDING)

        response = self._post(f"{self._path(leave)}hr-cancel/", user=self.hr_user, data={"comment": "Company decision"})

        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertEqual(row.status, CancellationRequest.Status.CONFIRMED)
        self.assertEqual(row.decided_by, self.hr_user)
        self.assertEqual(row.decision_note, "Company decision")
        leave.refresh_from_db()
        self.assertEqual(leave.status, LeaveStatus.CANCELLED)
        snapshot = get_workflow_snapshot(leave, actor=self.employee)
        self.assertFalse(snapshot["can_withdraw_cancellation_request"])

    def test_inbox_is_hr_only_and_company_scoped(self):
        other_company = OrganizationNode.objects.create(
            code="CRQ_B", name="Cancellation Company B", node_type=OrganizationNode.NodeType.COMPANY
        )
        outsider = self._user("cr-outsider@example.com", "EMP-CRQ-B1", company=other_company)
        outsider_hr = self._user("cr-outsider-hr@example.com", "EMP-CRQ-B2", hr=True, company=other_company)
        own = self._leave()
        foreign = self._leave(employee=outsider)
        self._request_cancellation(self._path(own))
        foreign_response = self._post(
            f"{self._path(foreign)}request-cancellation/",
            user=outsider,
            data={"reason": "Other company"},
            company=other_company,
        )
        self.assertEqual(foreign_response.status_code, 201, foreign_response.data)
        foreign_row = CancellationRequest.objects.get(object_id=foreign.id)

        listing = self._client(self.hr_user).get(CR_URL)
        self.assertEqual([item["request_id"] for item in listing.data["data"]["items"]], [own.id])
        self.assertEqual(self._post(f"{CR_URL}{foreign_row.id}/confirm/", user=self.hr_user).status_code, 404)
        foreign_listing = self._client(outsider_hr, other_company).get(CR_URL)
        self.assertEqual([item["request_id"] for item in foreign_listing.data["data"]["items"]], [foreign.id])

        self.assertEqual(self._client(self.employee).get(CR_URL).status_code, 403)
        own_row = CancellationRequest.objects.get(object_id=own.id)
        self.assertEqual(self._post(f"{CR_URL}{own_row.id}/confirm/", user=self.colleague).status_code, 403)
        self.assertEqual(self._post(f"{CR_URL}{own_row.id}/decline/", user=self.employee).status_code, 403)

    def test_inbox_filters_and_paginates(self):
        leaves = [self._leave(start=self.today + timedelta(days=10 * n)) for n in range(1, 4)]
        for leave in leaves:
            self._request_cancellation(self._path(leave))
        rows = list(CancellationRequest.objects.order_by("id"))
        self._post(f"{CR_URL}{rows[0].id}/decline/", user=self.hr_user, data={"comment": "No"})
        loan = self._loan()
        self._request_cancellation(f"/api/loans/loan-requests/{loan.id}/")

        client = self._client(self.hr_user)
        pending = client.get(CR_URL).data["data"]
        self.assertEqual(pending["count"], 3)
        self.assertEqual(client.get(f"{CR_URL}?status=all").data["data"]["count"], 4)
        self.assertEqual(client.get(f"{CR_URL}?status=declined").data["data"]["count"], 1)
        loans_only = client.get(f"{CR_URL}?kind=loan").data["data"]
        self.assertEqual([item["request_id"] for item in loans_only["items"]], [loan.id])
        self.assertEqual(loans_only["items"][0]["detail_path"], f"/hr/loan-requests/{loan.id}")
        page = client.get(f"{CR_URL}?status=all&page_size=1&page=2").data["data"]
        self.assertEqual((page["page"], page["page_size"], page["count"], page["total_pages"]), (2, 1, 4, 4))
        self.assertEqual(len(page["items"]), 1)
        for query in ("status=bogus", "kind=bogus"):
            with self.subTest(query=query):
                response = client.get(f"{CR_URL}?{query}")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"][0]["field"], query.split("=")[0])

    def test_list_snapshots_carry_the_flags(self):
        leave = self._leave()
        pending_leave = self._leave(status=LeaveStatus.PENDING_HR)
        self._request_cancellation(self._path(leave))
        snapshots = get_workflow_snapshots([leave, pending_leave], actor=self.employee)
        self.assertTrue(snapshots[leave.id]["can_withdraw_cancellation_request"])
        self.assertEqual(snapshots[leave.id]["cancellation_request"]["status"], "pending")
        self.assertIsNone(snapshots[pending_leave.id]["cancellation_request"])
        self.assertFalse(snapshots[pending_leave.id]["can_request_cancellation"])
        self.assertTrue(snapshots[pending_leave.id]["can_cancel"])

        listing = self._client(self.employee).get("/api/leaves/employee/leave-requests/")
        row = next(item for item in listing.data["data"]["items"] if item["id"] == leave.id)
        self.assertTrue(row["workflow"]["can_withdraw_cancellation_request"])
        hr_view = self._client(self.hr_user).get(self._path(leave)).data["data"]["workflow"]
        self.assertFalse(hr_view["can_withdraw_cancellation_request"])
        self.assertEqual(hr_view["cancellation_request"]["status"], "pending")


class PermissionCancellationRequestTests(CancellationRequestTestBase):
    def _path(self, obj):
        return f"/api/permission-requests/{obj.id}/"

    def test_confirm_reverses_the_attendance_adjustment(self):
        permission = self._permission()
        _upsert_attendance_adjustment(permission, actor=self.hr_user)
        source = {"kind": AttendanceAdjustment.Kind.EXIT_PERMISSION, "source_key": str(permission.pk)}
        self.assertTrue(AttendanceAdjustment.objects.filter(**source).exists())

        response = self._request_cancellation(self._path(permission), reason="Appointment moved")
        self.assertEqual(response.status_code, 201, response.data)
        workflow = response.data["data"]["workflow"]
        self.assertTrue(workflow["can_withdraw_cancellation_request"])
        self.assertFalse(workflow["can_cancel"])
        requested = self._actions(permission, Action.CANCELLATION_REQUESTED).get()
        self.assertEqual(requested.note, "")  # the reason stays out of the permission history
        row = CancellationRequest.objects.get()

        with (
            patch("attendance.calculation.AttendanceCalculationService.recalculate") as recalculate,
            self.captureOnCommitCallbacks(execute=True),
        ):
            confirmed = self._post(f"{CR_URL}{row.id}/confirm/", user=self.hr_user)
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        permission.refresh_from_db()
        self.assertEqual(permission.status, PermissionRequest.Status.CANCELLED)
        self.assertIsNotNone(permission.cancelled_at)
        self.assertFalse(AttendanceAdjustment.objects.filter(**source).exists())
        recalculate.assert_called_once_with(permission.employee_profile, permission.request_date)
        cancel = self._actions(permission, Action.CANCEL).get()
        self.assertEqual((cancel.actor, cancel.approver_role), (self.hr_user, "hr"))

    def test_past_and_unapproved_permissions_are_refused(self):
        past = self._permission(request_date=self.today - timedelta(days=1), number=2)
        pending = self._permission(status=PermissionRequest.Status.PENDING_HR, number=3)
        for permission, message in ((past, PERMISSION_PAST_MESSAGE), (pending, NOT_APPROVED_MESSAGE)):
            with self.subTest(status=permission.status):
                response = self._request_cancellation(self._path(permission))
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"], [message])
        self.assertEqual(self._request_cancellation(self._path(past), user=self.colleague).status_code, 404)


class AssetCancellationRequestTests(CancellationRequestTestBase):
    def test_legacy_approved_return_without_decision_timestamps_still_loads(self):
        request_obj = AssetReturnRequest.objects.create(
            asset=self._asset(), employee=self.employee.employee_profile, note="Old row", status="APPROVED"
        )

        snapshot = get_workflow_snapshot(request_obj, actor=self.employee)

        self.assertEqual(snapshot["status"], "approved")
        listing = self._client(self.employee).get("/api/assets/my-return-requests/")
        self.assertEqual(listing.status_code, 200, listing.data)

    def test_return_request_confirm_keeps_the_assignment(self):
        asset = self._asset()
        request_obj = AssetReturnRequest.objects.create(
            asset=asset,
            employee=self.employee.employee_profile,
            note="Not needed",
            status="APPROVED",
            hr_decision_by=self.hr_user,
            hr_decision_at=timezone.now(),
        )
        path = f"/api/assets/return-requests/{request_obj.id}/"
        listing = self._client(self.employee).get("/api/assets/my-return-requests/")
        row = next(item for item in listing.data["data"]["items"] if item["id"] == request_obj.id)
        self.assertTrue(row["workflow"]["can_request_cancellation"])

        response = self._request_cancellation(path)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["data"]["workflow"]["cancellation_request"]["status"], "pending")
        self.assertEqual(self._request_cancellation(path, user=self.colleague).status_code, 404)

        row = CancellationRequest.objects.get()
        self.assertEqual(self._post(f"{CR_URL}{row.id}/confirm/", user=self.hr_user).status_code, 200)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, AssetReturnRequest.RequestStatus.CANCELLED)
        self.assertTrue(AssetAssignment.objects.filter(asset=asset, is_active=True).exists())
        self.assertEqual(self._actions(request_obj, Action.CANCEL).get().actor, self.hr_user)

    def test_processed_or_pending_return_requests_are_refused(self):
        asset = self._asset()
        for current, message in (("PROCESSED", RETURN_PROCESSED_MESSAGE), ("PENDING", NOT_APPROVED_MESSAGE)):
            with self.subTest(status=current):
                request_obj = AssetReturnRequest.objects.create(
                    asset=asset, employee=self.employee.employee_profile, note="Done", status=current
                )
                response = self._request_cancellation(f"/api/assets/return-requests/{request_obj.id}/")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"], [message])

    def test_damage_report_decline_then_confirm(self):
        report = AssetDamageReport.objects.create(
            asset=self._asset(), employee=self.employee.employee_profile, description="Cracked", status="APPROVED"
        )
        path = f"/api/assets/damage-reports/{report.id}/"
        self.assertEqual(self._request_cancellation(path).status_code, 201)
        first = CancellationRequest.objects.get()
        self.assertEqual(
            self._post(f"{CR_URL}{first.id}/decline/", user=self.hr_user, data={"comment": "Keep it"}).status_code,
            200,
        )
        report.refresh_from_db()
        self.assertEqual(report.status, "APPROVED")
        self.assertEqual(self._request_cancellation(path).status_code, 201)
        second = CancellationRequest.objects.get(status="pending")
        self.assertEqual(self._post(f"{CR_URL}{second.id}/confirm/", user=self.hr_user).status_code, 200)
        report.refresh_from_db()
        self.assertEqual(report.status, AssetDamageReport.RequestStatus.CANCELLED)
        actions = list(self._actions(report).values_list("action", flat=True))
        self.assertEqual(
            actions[-4:], ["cancellation_requested", "cancellation_declined", "cancellation_requested", "cancel"]
        )
        pending_report = AssetDamageReport.objects.create(
            asset=report.asset, employee=self.employee.employee_profile, description="Dent", status="PENDING_HR"
        )
        pending = self._request_cancellation(f"/api/assets/damage-reports/{pending_report.id}/")
        self.assertEqual(pending.status_code, 422)
        self.assertEqual(pending.data["errors"], [NOT_APPROVED_MESSAGE])


class SettlementCancellationRequestTests(CancellationRequestTestBase):
    def test_approved_settlement_cannot_be_cancelled_by_request_until_payout_is_verifiable(self):
        settlement = self._settlement()
        detail = self._client(self.employee).get(f"/api/leaves/annual-leave-payments/{settlement.id}/")
        self.assertFalse(detail.data["data"]["workflow"]["can_request_cancellation"])

        response = self._request_cancellation(f"/api/leaves/annual-leave-payments/{settlement.id}/")

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["errors"], [SETTLEMENT_PAYOUT_UNVERIFIED_MESSAGE])
        self.assertFalse(CancellationRequest.objects.exists())

    def test_hr_opened_termination_and_pending_settlements_are_refused(self):
        cases = (
            (self._settlement(submitted_by=self.hr_user), SETTLEMENT_NOT_OWN_MESSAGE),
            (self._settlement(is_termination_settlement=True), SETTLEMENT_NOT_OWN_MESSAGE),
            (self._settlement(status=AnnualLeavePaymentRequest.Status.PENDING_HR), NOT_APPROVED_MESSAGE),
            (self._settlement(status=AnnualLeavePaymentRequest.Status.CARRIED_FORWARD), NOT_APPROVED_MESSAGE),
        )
        for settlement, message in cases:
            with self.subTest(settlement=settlement.id):
                response = self._request_cancellation(f"/api/leaves/annual-leave-payments/{settlement.id}/")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"], [message])


class LoanCancellationRequestTests(CancellationRequestTestBase):
    def test_pending_disbursement_loan_is_cancelled_on_confirm(self):
        loan = self._loan()
        snapshot = get_workflow_snapshot(loan, actor=self.employee)
        self.assertFalse(snapshot["can_cancel"])
        self.assertTrue(snapshot["can_request_cancellation"])
        path = f"/api/loans/loan-requests/{loan.id}/"
        response = self._request_cancellation(path)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["data"]["workflow"]["can_withdraw_cancellation_request"])

        row = CancellationRequest.objects.get()
        self.assertEqual(self._post(f"{CR_URL}{row.id}/confirm/", user=self.hr_user).status_code, 200)
        loan.refresh_from_db()
        self.assertEqual(loan.status, LoanRequest.RequestStatus.CANCELLED)
        self.assertFalse(
            LoanRequest.objects.filter(pk=loan.pk, status=LoanRequest.RequestStatus.PENDING_DISBURSEMENT).exists()
        )
        self.assertEqual(self._actions(loan, Action.CANCEL).get().approver_role, "hr")

    def test_disbursed_deducted_and_earlier_loans_are_refused(self):
        cases = (
            (LoanRequest.RequestStatus.APPROVED, LOAN_DISBURSED_MESSAGE),
            (LoanRequest.RequestStatus.DEDUCTED, LOAN_DISBURSED_MESSAGE),
            (LoanRequest.RequestStatus.PENDING_CFO, LOAN_NOT_AWAITING_DISBURSEMENT_MESSAGE),
        )
        for current, message in cases:
            with self.subTest(status=current):
                loan = self._loan(status=current)
                response = self._request_cancellation(f"/api/loans/loan-requests/{loan.id}/")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"], [message])
        other = self._loan()
        self.assertEqual(
            self._request_cancellation(f"/api/loans/loan-requests/{other.id}/", user=self.colleague).status_code, 404
        )
