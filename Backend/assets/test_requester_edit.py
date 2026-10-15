"""The employee edits the note of their own asset return request while it waits on the manager."""

from datetime import date
from unittest.mock import patch

from audit.models import AuditLog
from core.models import WorkflowAction
from core.services.workflow_engine import get_workflow_snapshot
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from employees.models import EmployeeProfile
from loans.models import LoanWorkflowConfig
from organization.models import UserOrganizationAccess
from organization.services import get_default_company
from rest_framework.test import APITestCase

from assets.models import Asset, AssetAssignment, AssetReturnRequest
from assets.services.return_requests import (
    NOT_REQUESTER_EDITABLE_MESSAGE,
    AssetReturnTransitionError,
    apply_manager_decision,
    edit_return_request,
    record_return_request_submission,
)

User = get_user_model()
Status = AssetReturnRequest.RequestStatus
BASE = "/api/assets/"
DISPATCH = "in_app_notifications.dispatcher.dispatch_notification_channels"


class AssetReturnRequesterEditTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        LoanWorkflowConfig.objects.create(require_manager_stage=True, is_active=True)
        groups = {name: Group.objects.get_or_create(name=name)[0] for name in ("Employee", "Manager", "HRManager")}
        self.manager, self.manager_profile = self._user("asset-edit-manager@example.com", "AE-MGR", groups["Manager"])
        self.employee, self.profile = self._user(
            "asset-edit-employee@example.com", "AE-EMP", groups["Employee"], manager_profile=self.manager_profile
        )
        self.colleague, _ = self._user("asset-edit-colleague@example.com", "AE-CO", groups["Employee"])
        self.hr_user, _ = self._user("asset-edit-hr@example.com", "AE-HR", groups["HRManager"])
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)
        self.asset = Asset.objects.create(
            company=self.company,
            name_en="Edit Test Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
        )
        AssetAssignment.objects.create(
            asset=self.asset, employee=self.profile, assigned_by=self.hr_user, is_active=True
        )

    def _user(self, email, employee_id, group, **profile_fields):
        user = User.objects.create_user(email=email, password="password")
        user.groups.add(group)
        profile = EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            full_name=email.split("@")[0],
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            **profile_fields,
        )
        return user, profile

    def _return_request(self, status=Status.PENDING_MANAGER):
        request_obj = AssetReturnRequest.objects.create(
            asset=self.asset, employee=self.profile, note="No longer needed", status=status
        )
        record_return_request_submission(request_obj, actor=self.employee)
        return request_obj

    def _edit(self, request_obj, body, user=None):
        self.client.force_authenticate(user=user or self.employee)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.patch(f"{BASE}return-requests/{request_obj.pk}/edit/", body, format="json")

    def _edits(self, request_obj):
        return WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(AssetReturnRequest),
            workflow__object_id=request_obj.pk,
            action=WorkflowAction.Action.EDIT,
        )

    def test_submission_waits_on_the_manager_and_owner_edits_the_note(self):
        self.client.force_authenticate(user=self.employee)
        created = self.client.post(f"{BASE}{self.asset.id}/return-request/", {"note": "Leaving"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        request_obj = AssetReturnRequest.objects.get(pk=created.data["data"]["id"])
        self.assertEqual(request_obj.status, Status.PENDING_MANAGER)

        with patch(DISPATCH) as dispatch:
            response = self._edit(request_obj, {"note": "Moving to another team"})

        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual(
            (data["note"], data["status"], data["asset"]), ("Moving to another team", "PENDING_MANAGER", self.asset.id)
        )
        self.assertEqual((data["workflow"]["can_edit"], data["workflow"]["can_cancel"]), (True, True))
        self.assertEqual(data["workflow"]["history"][-1]["action"], "edit")

        edit = self._edits(request_obj).get()
        self.assertEqual((edit.actor, edit.approver_role, edit.note), (self.employee, "", "Edited: note"))
        self.assertEqual(edit.metadata["changed_fields"], ["note"])
        log = AuditLog.objects.get(action="asset_return_request_edited", entity_id=str(request_obj.pk))
        self.assertEqual((log.metadata["changed_fields"], log.metadata["from_status"]), (["note"], "PENDING_MANAGER"))
        self.assertNotIn("Moving to another team", str(log.metadata))

        (call,) = dispatch.call_args_list
        self.assertEqual((call.kwargs["recipient"], call.kwargs["event_key"]), (self.manager, "asset_return.updated"))
        self.assertFalse(call.kwargs["whatsapp_enabled"])

    def test_unchanged_or_empty_body_records_nothing(self):
        request_obj = self._return_request()

        with patch(DISPATCH) as dispatch:
            same = self._edit(request_obj, {"note": "No longer needed"})
            empty = self._edit(request_obj, {})

        self.assertEqual((same.status_code, empty.status_code), (200, 200))
        self.assertFalse(self._edits(request_obj).exists())
        self.assertFalse(AuditLog.objects.filter(action="asset_return_request_edited").exists())
        self.assertFalse(dispatch.called)

    def test_requests_past_the_manager_stage_cannot_be_edited(self):
        for current in (
            Status.PENDING,
            Status.PENDING_CEO,
            Status.APPROVED,
            Status.PROCESSED,
            Status.REJECTED,
            Status.CANCELLED,
        ):
            with self.subTest(status=current):
                request_obj = self._return_request(status=current)
                self.assertFalse(get_workflow_snapshot(request_obj, actor=self.employee)["can_edit"])

                response = self._edit(request_obj, {"note": "Changed"})

                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"], [NOT_REQUESTER_EDITABLE_MESSAGE])
                request_obj.refresh_from_db()
                self.assertEqual(request_obj.note, "No longer needed")
                self.assertFalse(self._edits(request_obj).exists())

        request_obj = self._return_request()
        AssetReturnRequest.objects.filter(pk=request_obj.pk).update(manager_decision_at=timezone.now())
        request_obj.refresh_from_db()
        self.assertFalse(get_workflow_snapshot(request_obj, actor=self.employee)["can_edit"])
        self.assertEqual(self._edit(request_obj, {"note": "Changed"}).status_code, 422)

    def test_only_the_owner_can_edit(self):
        request_obj = self._return_request()

        for user in (self.manager, self.hr_user, self.colleague):
            with self.subTest(user=user.email):
                self.assertFalse(get_workflow_snapshot(request_obj, actor=user)["can_edit"])
                self.assertEqual(self._edit(request_obj, {"note": "Changed"}, user=user).status_code, 404)
        self.assertTrue(get_workflow_snapshot(request_obj, actor=self.employee)["can_edit"])

        with self.assertRaises(AssetReturnTransitionError) as refused:
            edit_return_request(request_obj, actor=self.manager, validate=lambda locked: {})
        self.assertEqual(refused.exception.status, 403)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.note, "No longer needed")

    def test_my_return_requests_list_exposes_the_flag(self):
        self._return_request()
        self.client.force_authenticate(user=self.employee)

        items = self.client.get(f"{BASE}my-return-requests/").data["data"]["items"]

        self.assertTrue(items[0]["workflow"]["can_edit"])

    def test_note_is_validated_and_the_asset_cannot_change(self):
        request_obj = self._return_request()

        blank = self._edit(request_obj, {"note": "   "})
        moved = self._edit(request_obj, {"asset": 999, "note": "Other"})

        self.assertEqual(blank.status_code, 422)
        self.assertEqual(blank.data["errors"][0]["field"], "note")
        self.assertEqual(moved.status_code, 422)
        self.assertEqual(moved.data["errors"][0]["field"], "asset")
        request_obj.refresh_from_db()
        self.assertEqual((request_obj.note, request_obj.asset_id), ("No longer needed", self.asset.id))

    def test_notification_failure_never_breaks_the_edit(self):
        request_obj = self._return_request()

        with patch(DISPATCH, side_effect=RuntimeError("down")):
            response = self._edit(request_obj, {"note": "Changed"})

        self.assertEqual(response.status_code, 200, response.data)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.note, "Changed")

    def test_edit_racing_an_approval_is_refused_under_the_lock(self):
        request_obj = self._return_request()
        stale = AssetReturnRequest.objects.select_related("employee").get(pk=request_obj.pk)

        apply_manager_decision(request_obj, actor=self.manager, approve=True)

        def validate(locked):
            raise AssertionError("a decided request must be refused before validation")

        with self.assertRaises(AssetReturnTransitionError) as refused:
            edit_return_request(stale, actor=self.employee, validate=validate)
        self.assertEqual(refused.exception.status, 422)
        stale.refresh_from_db()
        self.assertEqual((stale.status, stale.note), (Status.PENDING, "No longer needed"))
        self.assertFalse(self._edits(stale).exists())
