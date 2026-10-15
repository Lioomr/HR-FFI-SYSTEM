"""Employee edit of their own leave request before it reaches HR (``PATCH .../{id}/edit/``)."""

from datetime import date
from unittest.mock import patch

from audit.models import AuditLog
from core.models import DelegationRule, WorkflowAction
from core.services import get_workflow_snapshot, sync_leave_obligations
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from employees.models import EmployeeProfile
from organization.models import UserOrganizationAccess
from organization.services import get_default_company
from rest_framework import status
from rest_framework.test import APIRequestFactory, APITestCase

from leaves.models import LeaveRequest, LeaveType
from leaves.serializers import LeaveRequestSerializer
from leaves.services import (
    EDIT_DELEGATE_NOT_ALLOWED_MESSAGE,
    HR_MANUAL_NOT_EDITABLE_MESSAGE,
    NOT_REQUESTER_EDITABLE_MESSAGE,
    NOT_REQUESTER_EDITOR_MESSAGE,
    LeaveTransitionError,
    apply_manager_approval,
    apply_requester_edit,
)

User = get_user_model()

Status = LeaveRequest.RequestStatus
Action = WorkflowAction.Action
REQUESTS_URL = "/api/leaves/leave-requests/"


class LeaveRequesterEditTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.other_type = self._type("OTHER", "Other Leave")
        self.unpaid_type = self._type("UNPAID", "Unpaid Leave")
        self.sick_type = self._type("SICK", "Sick Leave")
        self.trip_type = self._type("BUSINESS_TRIP", "Business Trip")
        hr_group, _ = Group.objects.get_or_create(name="HRManager")

        self.manager = self._user("edit-leave-manager@example.com", "EMP-ELV-MGR")
        self.employee = self._user(
            "edit-leave-employee@example.com", "EMP-ELV-1", manager_profile=self.manager.employee_profile
        )
        self.colleague = self._user("edit-leave-colleague@example.com", "EMP-ELV-2")
        self.hr_user = self._user("edit-leave-hr@example.com", "EMP-ELV-HR")
        self.hr_user.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

    def _type(self, code, name):
        leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code=code, defaults={"name": name, "is_active": True}
        )
        if not leave_type.is_active:
            leave_type.is_active = True
            leave_type.save(update_fields=["is_active"])
        return leave_type

    def _user(self, email, employee_id, *, manager_profile=None):
        user = User.objects.create_user(email=email, password="password")
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            manager_profile=manager_profile,
        )
        return user

    def _leave(self, *, status=Status.PENDING_MANAGER, employee=None, leave_type=None, **fields):
        employee = employee or self.employee
        fields.setdefault("start_date", date(2027, 7, 1))
        fields.setdefault("end_date", date(2027, 7, 3))
        if status == Status.PENDING_DELEGATE:
            fields.setdefault("delegated_to", self.colleague)
        return LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            company=self.company,
            leave_type=leave_type or self.other_type,
            reason="Family visit",
            status=status,
            **fields,
        )

    def _edit(self, leave, body, *, user=None, format="json"):
        self.client.force_authenticate(user=user or self.employee)
        return self.client.patch(f"{REQUESTS_URL}{leave.id}/edit/", body, format=format)

    def _edits(self, leave):
        return WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(LeaveRequest),
            workflow__object_id=leave.id,
            action=Action.EDIT,
        )

    # --- editable window ---

    def test_owner_edits_request_before_hr_and_history_records_it(self):
        for month, current in enumerate((Status.SUBMITTED, Status.PENDING_DELEGATE, Status.PENDING_MANAGER), start=7):
            with self.subTest(status=current):
                leave = self._leave(status=current, start_date=date(2027, month, 1), end_date=date(2027, month, 3))
                self.assertTrue(get_workflow_snapshot(leave, actor=self.employee)["can_edit"])

                response = self._edit(leave, {"start_date": f"2027-{month:02d}-05", "end_date": f"2027-{month:02d}-08"})

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
                data = response.data["data"]
                self.assertEqual(
                    (data["start_date"], data["end_date"]), (f"2027-{month:02d}-05", f"2027-{month:02d}-08")
                )
                self.assertEqual(data["status"], current)
                self.assertTrue(data["workflow"]["can_edit"])
                leave.refresh_from_db()
                self.assertEqual((leave.status, leave.start_date), (current, date(2027, month, 5)))
                edit = self._edits(leave).get()
                self.assertEqual(
                    (edit.actor, edit.approver_role, edit.note),
                    (self.employee, "", "Edited: start_date, end_date"),
                )
                self.assertEqual((edit.from_status, edit.from_stage), (edit.to_status, edit.to_stage))
                self.assertEqual(edit.metadata["changed_fields"], ["start_date", "end_date"])
                self.assertEqual(data["workflow"]["history"][-1]["action"], "edit")
                audit_log = AuditLog.objects.filter(action="leave_request_edited", entity_id=str(leave.id)).get()
                self.assertEqual(
                    audit_log.metadata, {"changed_fields": ["start_date", "end_date"], "from_status": current}
                )

    def test_unchanged_body_records_nothing(self):
        leave = self._leave()
        response = self._edit(leave, {"reason": "Family visit"})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(self._edits(leave).exists())
        self.assertFalse(AuditLog.objects.filter(action="leave_request_edited", entity_id=str(leave.id)).exists())

    def test_request_at_hr_or_later_cannot_be_edited(self):
        for current in (
            Status.PENDING_HR,
            Status.PENDING_CEO,
            Status.PENDING_HR_COMPLETION,
            Status.APPROVED,
            Status.REJECTED,
            Status.CANCELLED,
        ):
            with self.subTest(status=current):
                leave = self._leave(status=current)
                self.assertFalse(get_workflow_snapshot(leave, actor=self.employee)["can_edit"])

                response = self._edit(leave, {"end_date": "2027-07-04"})

                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"], [NOT_REQUESTER_EDITABLE_MESSAGE])
                leave.refresh_from_db()
                self.assertEqual((leave.status, leave.end_date), (current, date(2027, 7, 3)))
                self.assertFalse(self._edits(leave).exists())

    def test_request_with_a_recorded_stage_decision_is_locked(self):
        # The alternative employee already approved; the request now waits on the manager.
        decided = self._leave(delegated_to=self.colleague, delegate_decision_at=timezone.now())
        # An alternative employee added once the request had reached HR.
        returned_from_hr = self._leave(status=Status.PENDING_DELEGATE, delegate_return_status=Status.PENDING_HR)

        for leave in (decided, returned_from_hr):
            with self.subTest(leave=leave.id):
                self.assertFalse(get_workflow_snapshot(leave, actor=self.employee)["can_edit"])
                response = self._edit(leave, {"end_date": "2027-07-04"})
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"], [NOT_REQUESTER_EDITABLE_MESSAGE])

    def test_hr_manual_record_is_never_employee_editable(self):
        leave = self._leave(source=LeaveRequest.RequestSource.HR_MANUAL, entered_by=self.hr_user)
        self.assertFalse(get_workflow_snapshot(leave, actor=self.employee)["can_edit"])

        response = self._edit(leave, {"end_date": "2027-07-04"})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["errors"], [HR_MANUAL_NOT_EDITABLE_MESSAGE])

    def test_only_the_requester_can_edit(self):
        leave = self._leave()
        self.assertFalse(get_workflow_snapshot(leave, actor=self.manager)["can_edit"])
        self.assertFalse(get_workflow_snapshot(leave, actor=self.hr_user)["can_edit"])
        self.assertFalse(get_workflow_snapshot(leave, actor=self.colleague)["can_edit"])

        for user in (self.manager, self.hr_user, self.colleague):
            with self.subTest(user=user.email):
                response = self._edit(leave, {"end_date": "2027-07-04"}, user=user)
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with self.assertRaisesMessage(LeaveTransitionError, NOT_REQUESTER_EDITOR_MESSAGE) as caught:
            apply_requester_edit(leave, actor=self.colleague, validate=lambda locked: {})
        self.assertEqual(caught.exception.status, 403)
        leave.refresh_from_db()
        self.assertEqual(leave.end_date, date(2027, 7, 3))

    def test_list_representation_exposes_can_edit_to_the_owner_only(self):
        editable = self._leave()
        locked = self._leave(status=Status.PENDING_HR, start_date=date(2027, 8, 1), end_date=date(2027, 8, 2))

        def flags(user):
            request = APIRequestFactory().get(REQUESTS_URL)
            request.user = user
            items = LeaveRequestSerializer([editable, locked], many=True, context={"request": request}).data
            return [item["workflow"]["can_edit"] for item in items]

        self.assertEqual(flags(self.employee), [True, False])
        self.assertEqual(flags(self.manager), [False, False])
        self.assertEqual(flags(self.hr_user), [False, False])

    def test_delegate_cannot_be_changed_by_editing(self):
        leave = self._leave()
        response = self._edit(leave, {"delegated_to": self.colleague.id})
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["errors"], [f"delegated_to: {EDIT_DELEGATE_NOT_ALLOWED_MESSAGE}"])
        leave.refresh_from_db()
        self.assertIsNone(leave.delegated_to)

    # --- revalidation with the create rules ---

    def test_overlap_check_ignores_the_request_itself_but_blocks_other_requests(self):
        leave = self._leave()
        response = self._edit(leave, {"start_date": "2027-07-02", "end_date": "2027-07-04"})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        self._leave(start_date=date(2027, 7, 10), end_date=date(2027, 7, 12))
        response = self._edit(leave, {"end_date": "2027-07-11"})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("pending or approved leave request for this period", " ".join(response.data["errors"]))
        leave.refresh_from_db()
        self.assertEqual(leave.end_date, date(2027, 7, 4))

    def test_end_before_start_is_refused(self):
        leave = self._leave()
        response = self._edit(leave, {"end_date": "2027-06-20"})
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["errors"], ["end_date: End date must be after start date."])

    def test_yearly_cap_counts_other_requests_but_not_the_edited_one(self):
        leave = self._leave(leave_type=self.unpaid_type, start_date=date(2027, 10, 1), end_date=date(2027, 11, 4))

        # 40 days on its own fits the 60-day cap; its old 35 days must not count as well.
        response = self._edit(leave, {"end_date": "2027-11-09"})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        self._leave(leave_type=self.unpaid_type, start_date=date(2027, 7, 1), end_date=date(2027, 7, 30))
        response = self._edit(leave, {"end_date": "2027-11-10"})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("Unpaid leave exceeds annual maximum", " ".join(response.data["errors"]))
        leave.refresh_from_db()
        self.assertEqual((leave.status, leave.end_date), (Status.PENDING_MANAGER, date(2027, 11, 9)))

    def test_changing_leave_type_reruns_the_policy(self):
        leave = self._leave()

        response = self._edit(leave, {"leave_type": self.sick_type.id})
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("Medical report document is required", " ".join(response.data["errors"]))

        report = SimpleUploadedFile("report.pdf", b"%PDF-1.4 report", content_type="application/pdf")
        response = self._edit(leave, {"leave_type": self.sick_type.id, "document": report}, format="multipart")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        leave.refresh_from_db()
        self.assertEqual(leave.leave_type, self.sick_type)
        self.assertTrue(leave.document)
        self.assertEqual(self._edits(leave).get().metadata["changed_fields"], ["leave_type", "document"])

    def test_business_trip_delegation_rule_follows_the_new_dates(self):
        leave = self._leave(status=Status.PENDING_DELEGATE, leave_type=self.trip_type)
        sync_leave_obligations(leave, actor=self.employee)
        rule = DelegationRule.objects.get(from_user=self.employee, to_user=self.colleague, is_active=True)
        self.assertEqual(timezone.localtime(rule.end_at).date(), date(2027, 7, 3))

        response = self._edit(leave, {"end_date": "2027-07-06"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        rule.refresh_from_db()
        self.assertEqual(timezone.localtime(rule.end_at).date(), date(2027, 7, 6))

        response = self._edit(leave, {"leave_type": self.other_type.id})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(
            DelegationRule.objects.filter(from_user=self.employee, to_user=self.colleague, is_active=True).exists()
        )

    # --- notifications ---

    @patch("leaves.services.dispatch_notification_channels")
    def test_current_approver_is_told_about_the_update(self, dispatch):
        manager_stage = self._leave()
        self._edit(manager_stage, {"end_date": "2027-07-04"})
        delegate_stage = self._leave(
            status=Status.PENDING_DELEGATE, start_date=date(2027, 9, 1), end_date=date(2027, 9, 2)
        )
        self._edit(delegate_stage, {"end_date": "2027-09-03"})

        calls = [(call.kwargs["recipient"], call.kwargs["event_key"]) for call in dispatch.call_args_list]
        self.assertEqual(calls, [(self.manager, "leave.updated"), (self.colleague, "leave.updated")])
        self.assertIn("updated leave request", dispatch.call_args_list[0].kwargs["message"])

    @patch("leaves.services.dispatch_notification_channels", side_effect=RuntimeError("provider down"))
    def test_notification_failure_never_breaks_the_edit(self, _dispatch):
        leave = self._leave()
        with self.assertLogs("leaves.services", level="ERROR") as logs:
            response = self._edit(leave, {"end_date": "2027-07-04"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        leave.refresh_from_db()
        self.assertEqual(leave.end_date, date(2027, 7, 4))
        self.assertTrue(any("leave_edit_notification_failed" in line for line in logs.output))

    # --- concurrency ---

    def test_edit_after_a_racing_approval_is_refused_under_the_lock(self):
        leave = self._leave()
        stale = LeaveRequest.objects.get(pk=leave.pk)  # read before the manager decides

        apply_manager_approval(leave, actor=self.manager)

        def validate(locked):
            raise AssertionError("an approved stage must be refused before validation")

        with self.assertRaisesMessage(LeaveTransitionError, NOT_REQUESTER_EDITABLE_MESSAGE):
            apply_requester_edit(stale, actor=self.employee, validate=validate)
        leave.refresh_from_db()
        self.assertEqual((leave.status, leave.end_date), (Status.PENDING_HR, date(2027, 7, 3)))
        self.assertFalse(self._edits(leave).exists())
