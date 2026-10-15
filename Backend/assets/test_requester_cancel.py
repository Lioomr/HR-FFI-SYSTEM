"""The employee cancels their own pending asset return request or damage report."""

from datetime import date

from audit.models import AuditLog
from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import get_pending_approvals_for_role, get_workflow_snapshot
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from employees.models import EmployeeProfile
from organization.models import UserOrganizationAccess
from organization.services import get_default_company
from rest_framework import status
from rest_framework.test import APITestCase

from assets.models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest
from assets.services.damage_reports import NOT_CANCELLABLE_MESSAGE as DAMAGE_NOT_CANCELLABLE
from assets.services.return_requests import NOT_CANCELLABLE_MESSAGE as RETURN_NOT_CANCELLABLE
from assets.services.return_requests import record_return_request_submission

User = get_user_model()

ReturnStatus = AssetReturnRequest.RequestStatus
DamageStatus = AssetDamageReport.RequestStatus
Action = WorkflowAction.Action
BASE = "/api/assets/"


class AssetRequesterCancelTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.employee, self.profile = self._user("asset-cancel-employee@example.com", "EMP-ACX-1")
        self.colleague, _ = self._user("asset-cancel-colleague@example.com", "EMP-ACX-2")
        self.hr_user, _ = self._user("asset-cancel-hr@example.com", "EMP-ACX-HR")
        for user in (self.employee, self.colleague):
            user.groups.add(employee_group)
        self.hr_user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)
        self.asset = Asset.objects.create(
            company=self.company,
            name_en="Cancel Test Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
        )
        AssetAssignment.objects.create(
            asset=self.asset, employee=self.profile, assigned_by=self.hr_user, is_active=True
        )

    def _user(self, email, employee_id):
        user = User.objects.create_user(email=email, password="password")
        profile = EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        return user, profile

    def _return_request(self, status=ReturnStatus.PENDING):
        request_obj = AssetReturnRequest.objects.create(
            asset=self.asset, employee=self.profile, note="No longer needed", status=status
        )
        record_return_request_submission(request_obj, actor=self.employee)
        return request_obj

    def _damage_report(self, status=DamageStatus.PENDING_HR):
        return AssetDamageReport.objects.create(
            asset=self.asset, employee=self.profile, description="Cracked screen", status=status
        )

    def _post(self, path, user=None):
        self.client.force_authenticate(user=user or self.employee)
        return self.client.post(f"{BASE}{path}", {}, format="json")

    def _cancel_actions(self, model, object_id):
        return WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(model),
            workflow__object_id=object_id,
            action=Action.CANCEL,
        )

    # --- return requests ---

    def test_employee_cancels_pending_return_request(self):
        for current in (ReturnStatus.PENDING_MANAGER, ReturnStatus.PENDING, ReturnStatus.PENDING_CEO):
            with self.subTest(status=current):
                request_obj = self._return_request(status=current)
                self.assertTrue(get_workflow_snapshot(request_obj, actor=self.employee)["can_cancel"])
                self.assertFalse(get_workflow_snapshot(request_obj, actor=self.colleague)["can_cancel"])
                request_obj.refresh_from_db()
                from_status = request_obj.status

                response = self._post(f"return-requests/{request_obj.id}/cancel/")

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
                data = response.data["data"]
                self.assertEqual(data["status"], ReturnStatus.CANCELLED)
                self.assertIsNotNone(data["cancelled_at"])
                self.assertEqual((data["workflow"]["status"], data["workflow"]["can_cancel"]), ("cancelled", False))
                cancel = self._cancel_actions(AssetReturnRequest, request_obj.id).get()
                self.assertEqual((cancel.actor, cancel.to_status), (self.employee, "cancelled"))
                audit_log = AuditLog.objects.filter(
                    action="asset_return_request_cancelled", entity_id=str(request_obj.id)
                ).last()
                self.assertEqual(audit_log.metadata["from_status"], from_status)

    def test_decided_return_requests_cannot_be_cancelled(self):
        for current in (ReturnStatus.APPROVED, ReturnStatus.PROCESSED, ReturnStatus.REJECTED, ReturnStatus.CANCELLED):
            with self.subTest(status=current):
                request_obj = AssetReturnRequest.objects.create(
                    asset=self.asset, employee=self.profile, note="Done", status=current
                )
                response = self._post(f"return-requests/{request_obj.id}/cancel/")
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"], [RETURN_NOT_CANCELLABLE])
                request_obj.refresh_from_db()
                self.assertEqual(request_obj.status, current)

    def test_only_the_requester_can_cancel_a_return_request(self):
        request_obj = self._return_request()
        for user in (self.colleague, self.hr_user):
            with self.subTest(user=user.email):
                response = self._post(f"return-requests/{request_obj.id}/cancel/", user=user)
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, ReturnStatus.PENDING)
        self.assertEqual(self._post("return-requests/999999/cancel/").status_code, status.HTTP_404_NOT_FOUND)

    def test_cancelled_return_request_leaves_inbox_and_unblocks_a_new_request(self):
        request_obj = self._return_request(status=ReturnStatus.PENDING)
        content_type = ContentType.objects.get_for_model(AssetReturnRequest)
        pending = {(w.content_type_id, w.object_id) for w in get_pending_approvals_for_role("hr", limit=None)}
        self.assertIn((content_type.id, request_obj.id), pending)
        self.client.force_authenticate(user=self.employee)
        blocked = self.client.post(f"{BASE}{self.asset.id}/return-request/", {"note": "Again"}, format="json")
        self.assertEqual(blocked.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        self.assertEqual(self._post(f"return-requests/{request_obj.id}/cancel/").status_code, status.HTTP_200_OK)

        pending = {(w.content_type_id, w.object_id) for w in get_pending_approvals_for_role("hr", limit=None)}
        self.assertNotIn((content_type.id, request_obj.id), pending)
        workflow = WorkflowInstance.objects.get(content_type=content_type, object_id=request_obj.id)
        self.assertEqual(workflow.status, WorkflowInstance.Status.CANCELLED)
        self.client.force_authenticate(user=self.employee)
        again = self.client.post(f"{BASE}{self.asset.id}/return-request/", {"note": "Again"}, format="json")
        self.assertEqual(again.status_code, status.HTTP_201_CREATED, again.data)

    def test_my_return_requests_exposes_the_cancel_flag(self):
        request_obj = self._return_request()
        self.client.force_authenticate(user=self.employee)
        response = self.client.get(f"{BASE}my-return-requests/")
        row = next(item for item in response.data["data"]["items"] if item["id"] == request_obj.id)
        self.assertTrue(row["workflow"]["can_cancel"])

    # --- damage reports ---

    def test_employee_cancels_pending_damage_report(self):
        for current in (DamageStatus.PENDING_HR, DamageStatus.PENDING_CEO):
            with self.subTest(status=current):
                report = self._damage_report(status=current)
                self.client.force_authenticate(user=self.employee)
                listing = self.client.get(f"{BASE}my-damage-reports/")
                row = next(item for item in listing.data["data"]["items"] if item["id"] == report.id)
                self.assertTrue(row["can_cancel"])

                response = self._post(f"damage-reports/{report.id}/cancel/")

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
                data = response.data["data"]
                self.assertEqual((data["status"], data["can_cancel"]), (DamageStatus.CANCELLED, False))
                self.assertIsNotNone(data["cancelled_at"])
                history = data["workflow"]["history"]
                self.assertEqual(history[-1]["action"], "cancel")
                self.assertEqual(history[-1]["actor"]["id"], self.employee.id)
                cancel = self._cancel_actions(AssetDamageReport, report.id).get()
                expected_stage = "hr" if current == DamageStatus.PENDING_HR else "ceo"
                self.assertEqual(
                    (cancel.actor, cancel.from_stage, cancel.to_status), (self.employee, expected_stage, "cancelled")
                )
                workflow = WorkflowInstance.objects.get(pk=cancel.workflow_id)
                self.assertEqual(workflow.status, WorkflowInstance.Status.CANCELLED)
                self.assertTrue(workflow.actions.filter(action=Action.SUBMIT, actor=self.employee).exists())
                self.assertTrue(
                    AuditLog.objects.filter(action="asset_damage_report_cancelled", entity_id=str(report.id)).exists()
                )

    def test_decided_damage_reports_cannot_be_cancelled(self):
        for current in (DamageStatus.APPROVED, DamageStatus.REJECTED, DamageStatus.CANCELLED):
            with self.subTest(status=current):
                report = self._damage_report(status=current)
                response = self._post(f"damage-reports/{report.id}/cancel/")
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"], [DAMAGE_NOT_CANCELLABLE])
                report.refresh_from_db()
                self.assertEqual(report.status, current)

    def test_only_the_reporter_can_cancel_a_damage_report(self):
        report = self._damage_report()
        for user in (self.colleague, self.hr_user):
            with self.subTest(user=user.email):
                response = self._post(f"damage-reports/{report.id}/cancel/", user=user)
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        report.refresh_from_db()
        self.assertEqual(report.status, DamageStatus.PENDING_HR)

    def test_cancelled_damage_report_drops_out_of_pending_lists(self):
        report = self._damage_report(status=DamageStatus.PENDING_HR)
        self._post(f"damage-reports/{report.id}/cancel/")

        self.client.force_authenticate(user=self.hr_user)
        hr_pending = self.client.get(f"{BASE}damage-reports/?status=PENDING_HR")
        self.assertNotIn(report.id, {item["id"] for item in hr_pending.data["data"]["items"]})
