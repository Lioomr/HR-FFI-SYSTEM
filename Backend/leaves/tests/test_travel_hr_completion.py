import importlib
from datetime import date, timedelta
from io import BytesIO
from unittest.mock import patch

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from reportlab.pdfgen import canvas
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import (
    get_pending_approvals_for_role,
    get_workflow_snapshot_read_only,
    sync_workflow,
)
from employees.models import EmployeeDocument, EmployeeProfile
from in_app_notifications.models import Notification
from leaves.models import LeaveRequest, LeaveType
from leaves.serializers import HRManualLeaveRequestSerializer, LeaveRequestCreateSerializer, LeaveRequestSerializer
from organization.models import UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()
Status = LeaveRequest.RequestStatus
reconcile_migration = importlib.import_module("leaves.migrations.0022_reconcile_legacy_hr_completion")

REQUESTS_URL = "/api/leaves/leave-requests/"
CEO_REQUESTS_URL = "/api/leaves/ceo/leave-requests/"


def _visa_pdf():
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.drawString(72, 750, "Visa Number: 209605081")
    pdf.drawString(72, 730, "Exit Before: 16/8/2026")
    pdf.drawString(72, 710, "Visa Duration: 60")
    pdf.save()
    return SimpleUploadedFile("visa.pdf", buffer.getvalue(), content_type="application/pdf")


def _hr_completion_history(workflow_snapshot):
    return [
        entry
        for entry in workflow_snapshot["history"]
        if "hr_completion" in {entry["stage"], entry["from_stage"], entry["to_stage"]}
    ]


class TravelHRCompletionTestBase(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.annual_type = self._leave_type("ANNUAL", "Annual Leave (travel tests)")
        self.sick_type = self._leave_type("SICK", "Sick Leave (travel tests)")
        self.business_trip_type = self._leave_type("BUSINESS_TRIP", "Business Trip (travel tests)")

        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        ceo_group, _ = Group.objects.get_or_create(name="CEO")
        self.hr_user = self._employee("travel-hr@example.com", "EMP-TRV-HR", group=hr_group)
        UserOrganizationAccess.objects.get_or_create(user=self.hr_user, organization=self.company)
        self.ceo_user = self._employee("travel-ceo@example.com", "EMP-TRV-CEO", group=ceo_group)
        self.non_saudi_user = self._employee("travel-non-saudi@example.com", "EMP-TRV-001")
        self.saudi_user = self._employee("travel-saudi@example.com", "EMP-TRV-002", is_saudi=True)

    def _leave_type(self, code, name):
        leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company,
            code=code,
            defaults={"name": name, "is_active": True},
        )
        return leave_type

    def _employee(self, email, employee_id, *, group=None, is_saudi=False):
        user = User.objects.create_user(email=email, password="password")
        if group:
            user.groups.add(group)
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Operations",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            is_saudi=is_saudi,
        )
        return user

    def _leave_request(self, user, *, leave_type=None, request_status=Status.PENDING_CEO, **fields):
        request_obj = LeaveRequest.objects.create(
            employee=user,
            leave_type=leave_type or self.annual_type,
            start_date=date(2026, 10, 8),
            end_date=date(2026, 10, 9),
            status=request_status,
            **fields,
        )
        sync_workflow(request_obj)
        return request_obj

    def _workflow(self, request_obj):
        return WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(LeaveRequest),
            object_id=request_obj.id,
        )

    def _in_hr_queue(self, request_obj):
        workflow = self._workflow(request_obj)
        return workflow.id in {item.id for item in get_pending_approvals_for_role("hr", limit=None)}

    def _ceo_approve(self, request_obj):
        self.client.force_authenticate(user=self.ceo_user)
        with (
            patch("leaves.services.notify_leave_approved") as notify_approved,
            patch("leaves.services.notify_users_for_pending_status") as notify_hr,
        ):
            response = self.client.post(
                f"{CEO_REQUESTS_URL}{request_obj.id}/approve/",
                {"comment": "Approved"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        request_obj.refresh_from_db()
        return response.data["data"], notify_approved, notify_hr

    def _complete(self, request_obj, payload):
        self.client.force_authenticate(user=self.hr_user)
        with patch("leaves.services.notify_leave_approved"):
            return self.client.post(f"{REQUESTS_URL}{request_obj.id}/complete/", payload, format="multipart")


class CEOApprovalRoutingTests(TravelHRCompletionTestBase):
    def assert_ceo_final_approval(self, request_obj, data, notify_approved, notify_hr):
        self.assertEqual(data["status"], Status.APPROVED)
        self.assertIs(data["requires_hr_completion_visa"], False)
        self.assertEqual(data["workflow"]["status"], WorkflowInstance.Status.APPROVED)
        self.assertEqual(data["workflow"]["current_stage"], "")
        self.assertEqual(_hr_completion_history(data["workflow"]), [])
        self.assertEqual(request_obj.status, Status.APPROVED)
        self.assertIsNone(request_obj.hr_completed_by)
        self.assertIsNone(request_obj.hr_completed_at)
        self.assertFalse(self._in_hr_queue(request_obj))
        notify_approved.assert_called_once()
        notify_hr.assert_not_called()

    def test_non_saudi_sick_leave_is_approved_by_ceo(self):
        request_obj = self._leave_request(self.non_saudi_user, leave_type=self.sick_type)

        data, notify_approved, notify_hr = self._ceo_approve(request_obj)

        self.assertIs(data["will_travel"], False)
        self.assert_ceo_final_approval(request_obj, data, notify_approved, notify_hr)

    def test_non_travel_leave_is_approved_by_ceo_for_saudi_and_non_saudi(self):
        for user in (self.saudi_user, self.non_saudi_user):
            with self.subTest(employee=user.email):
                request_obj = self._leave_request(user)

                self.assert_ceo_final_approval(request_obj, *self._ceo_approve(request_obj))

    def test_saudi_travel_leave_is_approved_by_ceo(self):
        request_obj = self._leave_request(self.saudi_user, will_travel=True)

        data, notify_approved, notify_hr = self._ceo_approve(request_obj)

        self.assertIs(data["will_travel"], True)
        self.assert_ceo_final_approval(request_obj, data, notify_approved, notify_hr)

    def test_non_saudi_travel_leave_moves_to_hr_completion(self):
        request_obj = self._leave_request(self.non_saudi_user, will_travel=True)

        data, notify_approved, notify_hr = self._ceo_approve(request_obj)

        self.assertEqual(data["status"], Status.PENDING_HR_COMPLETION)
        self.assertIs(data["will_travel"], True)
        self.assertIs(data["requires_hr_completion_visa"], True)
        self.assertEqual(data["workflow"]["status"], WorkflowInstance.Status.IN_REVIEW)
        self.assertEqual(data["workflow"]["current_stage"], "hr_completion")
        ceo_entry = next(entry for entry in data["workflow"]["history"] if entry["from_stage"] == "ceo")
        self.assertEqual((ceo_entry["to_status"], ceo_entry["to_stage"]), ("in_review", "hr_completion"))
        self.assertTrue(self._in_hr_queue(request_obj))
        notify_hr.assert_called_once()
        notify_approved.assert_not_called()
        audit_log = AuditLog.objects.filter(
            action="approve_ceo", entity="LeaveRequest", entity_id=str(request_obj.id)
        ).last()
        self.assertEqual(audit_log.metadata["approval_status"], Status.PENDING_HR_COMPLETION)
        self.assertIs(audit_log.metadata["requires_hr_completion"], True)

    def test_direct_ceo_approval_workflow_has_no_hr_completion_stage(self):
        request_obj = self._leave_request(self.non_saudi_user)

        self._ceo_approve(request_obj)

        workflow = self._workflow(request_obj)
        ceo_action = workflow.actions.get(from_stage="ceo")
        self.assertEqual(ceo_action.action, WorkflowAction.Action.APPROVE)
        self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("approved", ""))
        snapshot = get_workflow_snapshot_read_only(request_obj)
        self.assertEqual((snapshot["status"], snapshot["current_stage"]), ("approved", ""))
        self.assertEqual(_hr_completion_history(snapshot), [])

        # Later syncs keep the CEO approval as the final step.
        sync_workflow(request_obj)
        self.assertFalse(workflow.actions.filter(from_stage="hr_completion").exists())
        self.assertFalse(workflow.actions.filter(to_stage="hr_completion").exists())
        audit_log = AuditLog.objects.filter(
            action="approve_ceo", entity="LeaveRequest", entity_id=str(request_obj.id)
        ).last()
        self.assertEqual(audit_log.metadata["approval_status"], Status.APPROVED)
        self.assertIs(audit_log.metadata["requires_hr_completion"], False)

    def test_ceo_rejection_of_travel_leave_is_unchanged(self):
        request_obj = self._leave_request(self.non_saudi_user, will_travel=True)
        self.client.force_authenticate(user=self.ceo_user)

        with patch("leaves.services.notify_leave_rejected") as notify_rejected:
            response = self.client.post(
                f"{CEO_REQUESTS_URL}{request_obj.id}/reject/",
                {"comment": "Not now"},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.REJECTED)
        ceo_action = self._workflow(request_obj).actions.get(from_stage="ceo")
        self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("rejected", ""))
        notify_rejected.assert_called_once()


class WillTravelFieldTests(TravelHRCompletionTestBase):
    def _submit(self, payload, request_format, offset_days):
        start = timezone.localdate() + timedelta(days=offset_days)
        data = {
            "leave_type": self.annual_type.id,
            "start_date": str(start),
            "end_date": str(start + timedelta(days=1)),
            "reason": "Vacation",
            **payload,
        }
        self.client.force_authenticate(user=self.non_saudi_user)
        response = self.client.post(REQUESTS_URL, data, format=request_format)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data["data"]

    def test_omitted_will_travel_defaults_to_false(self):
        for offset_days, request_format in ((1, "json"), (10, "multipart")):
            with self.subTest(format=request_format):
                data = self._submit({}, request_format, offset_days)

                self.assertIs(data["will_travel"], False)
                self.assertIs(data["requires_hr_completion_visa"], False)
                self.assertIn("current_stage", data["workflow"])
                self.assertIs(LeaveRequest.objects.get(pk=data["id"]).will_travel, False)

                retrieved = self.client.get(f"{REQUESTS_URL}{data['id']}/")
                self.assertEqual(retrieved.status_code, status.HTTP_200_OK)
                self.assertIs(retrieved.data["data"]["will_travel"], False)

    def test_multipart_create_accepts_will_travel(self):
        for offset_days, raw_value, expected in ((20, "true", True), (30, "false", False)):
            with self.subTest(will_travel=raw_value):
                data = self._submit({"will_travel": raw_value}, "multipart", offset_days)

                self.assertIs(data["will_travel"], expected)
                self.assertIs(data["requires_hr_completion_visa"], expected)
                self.assertIs(LeaveRequest.objects.get(pk=data["id"]).will_travel, expected)

    def test_serializers_expose_will_travel(self):
        self.assertTrue(LeaveRequestSerializer().fields["will_travel"].read_only)
        self.assertIn("will_travel", LeaveRequestCreateSerializer.Meta.fields)
        self.assertFalse(HRManualLeaveRequestSerializer(context={}).fields["will_travel"].read_only)


class HRCompletionVisaTests(TravelHRCompletionTestBase):
    def test_rejects_non_saudi_travel_request_without_visa(self):
        request_obj = self._leave_request(
            self.non_saudi_user, request_status=Status.PENDING_HR_COMPLETION, will_travel=True
        )

        response = self._complete(request_obj, {"comment": "Done"})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, Status.PENDING_HR_COMPLETION)
        self.assertIsNone(request_obj.hr_completed_at)
        self.assertFalse(EmployeeDocument.objects.filter(leave_request=request_obj).exists())

    def test_rejects_non_pdf_visa(self):
        request_obj = self._leave_request(
            self.non_saudi_user, request_status=Status.PENDING_HR_COMPLETION, will_travel=True
        )
        upload = SimpleUploadedFile("visa.png", b"\x89PNG\r\n", content_type="image/png")

        response = self._complete(request_obj, {"visa_document": upload})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, Status.PENDING_HR_COMPLETION)
        self.assertFalse(EmployeeDocument.objects.filter(leave_request=request_obj).exists())

    def test_accepts_visa_pdf_and_approves_travel_request(self):
        request_obj = self._leave_request(self.non_saudi_user, will_travel=True)
        self._ceo_approve(request_obj)
        self.assertEqual(request_obj.status, Status.PENDING_HR_COMPLETION)

        response = self._complete(request_obj, {"comment": "Visa uploaded", "visa_document": _visa_pdf()})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        data = response.data["data"]
        self.assertEqual(data["status"], Status.APPROVED)
        self.assertIs(data["requires_hr_completion_visa"], True)
        self.assertEqual((data["workflow"]["status"], data["workflow"]["current_stage"]), ("approved", ""))
        transitions = [(entry["from_stage"], entry["to_stage"]) for entry in data["workflow"]["history"]]
        self.assertIn(("ceo", "hr_completion"), transitions)
        self.assertIn(("hr_completion", ""), transitions)
        document = EmployeeDocument.objects.get(leave_request=request_obj)
        self.assertEqual(document.document_type, EmployeeDocument.DocumentType.VISA)
        self.assertEqual(document.visa_number, "209605081")
        self.assertEqual(data["completion_document_id"], document.id)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.hr_completed_by, self.hr_user)
        audit_log = AuditLog.objects.filter(
            action="complete_hr", entity="LeaveRequest", entity_id=str(request_obj.id)
        ).last()
        self.assertIs(audit_log.metadata["visa_required"], True)
        self.assertEqual(audit_log.metadata["visa_document_id"], document.id)

    def test_non_travel_request_completes_without_visa(self):
        request_obj = self._leave_request(self.non_saudi_user, request_status=Status.PENDING_HR_COMPLETION)

        response = self._complete(request_obj, {"comment": "Done"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.APPROVED)
        self.assertFalse(EmployeeDocument.objects.filter(leave_request=request_obj).exists())


class LegacyHRCompletionMigrationTests(TravelHRCompletionTestBase):
    def _legacy_pending(self, user=None, **fields):
        return self._leave_request(
            user or self.non_saudi_user,
            request_status=Status.PENDING_HR_COMPLETION,
            ceo_decision_by=self.ceo_user,
            ceo_decision_at=timezone.now() - timedelta(days=1),
            ceo_decision_note="Legacy CEO approval",
            **fields,
        )

    def _run_migration(self):
        reconcile_migration.reconcile_legacy_hr_completion(django_apps, None)

    def _legacy_travel_rows(self, user):
        return [
            self._legacy_pending(user, leave_type=self.business_trip_type),
            self._legacy_pending(user, airplane_ticket_payer="company"),
            self._legacy_pending(user, airplane_ticket_address="Riyadh"),
        ]

    def test_non_travel_rows_become_ceo_final_approvals(self):
        non_travel_rows = [
            self._legacy_pending(),
            self._legacy_pending(leave_type=self.sick_type),
            self._legacy_pending(self.saudi_user),
        ]
        already_approved = self._leave_request(self.non_saudi_user, request_status=Status.APPROVED)
        notifications_before = Notification.objects.count()

        self._run_migration()

        for request_obj in non_travel_rows:
            with self.subTest(request=request_obj.id):
                request_obj.refresh_from_db()
                self.assertEqual(request_obj.status, Status.APPROVED)
                self.assertIs(request_obj.will_travel, False)
                self.assertIsNone(request_obj.hr_completed_by)
                self.assertIsNone(request_obj.hr_completed_at)
                self.assertFalse(self._in_hr_queue(request_obj))
        already_approved.refresh_from_db()
        self.assertEqual(already_approved.status, Status.APPROVED)
        self.assertIs(already_approved.will_travel, False)
        self.assertEqual(Notification.objects.count(), notifications_before)

    def test_non_saudi_travel_rows_remain_in_hr_completion(self):
        travel_rows = self._legacy_travel_rows(self.non_saudi_user)

        self._run_migration()

        for request_obj in travel_rows:
            with self.subTest(request=request_obj.id):
                request_obj.refresh_from_db()
                self.assertEqual(request_obj.status, Status.PENDING_HR_COMPLETION)
                self.assertIs(request_obj.will_travel, True)
                self.assertTrue(request_obj.requires_hr_completion())
                self.assertTrue(self._in_hr_queue(request_obj))
                workflow = self._workflow(request_obj)
                self.assertEqual((workflow.status, workflow.current_stage), ("in_review", "hr_completion"))
                ceo_action = workflow.actions.get(metadata__legacy_signature="ceo")
                self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("in_review", "hr_completion"))
                self.assertNotIn("reconciled_by", ceo_action.metadata)

    def test_saudi_travel_rows_become_ceo_final_approvals(self):
        travel_rows = self._legacy_travel_rows(self.saudi_user)
        for request_obj in travel_rows:
            self.assertTrue(self._in_hr_queue(request_obj))
        notifications_before = Notification.objects.count()

        self._run_migration()

        for request_obj in travel_rows:
            with self.subTest(request=request_obj.id):
                request_obj.refresh_from_db()
                self.assertEqual(request_obj.status, Status.APPROVED)
                self.assertIs(request_obj.will_travel, True)
                self.assertFalse(request_obj.requires_hr_completion())
                self.assertIsNone(request_obj.hr_completed_by)
                self.assertIsNone(request_obj.hr_completed_at)
                self.assertFalse(EmployeeDocument.objects.filter(leave_request=request_obj).exists())
                self.assertFalse(self._in_hr_queue(request_obj))
                workflow = self._workflow(request_obj)
                self.assertEqual((workflow.status, workflow.current_stage), ("approved", ""))
                self.assertEqual(workflow.decided_at, request_obj.ceo_decision_at)
                ceo_action = workflow.actions.get(metadata__legacy_signature="ceo")
                self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("approved", ""))
                self.assertEqual(ceo_action.metadata["original_to_stage"], "hr_completion")
                self.assertEqual(_hr_completion_history(get_workflow_snapshot_read_only(request_obj)), [])
        self.assertEqual(Notification.objects.count(), notifications_before)

    def test_reconciles_workflow_projection_for_ceo_final_rows(self):
        annual = self._legacy_pending()
        travel = self._legacy_pending(airplane_ticket_payer="company")
        self.assertTrue(self._in_hr_queue(annual))
        self.assertTrue(self._in_hr_queue(travel))

        self._run_migration()

        workflow = self._workflow(annual)
        self.assertEqual(workflow.status, WorkflowInstance.Status.APPROVED)
        self.assertEqual((workflow.current_stage, workflow.current_approver_role), ("", ""))
        self.assertIsNone(workflow.current_actor_user)
        self.assertEqual(workflow.decided_at, annual.ceo_decision_at)
        self.assertFalse(self._in_hr_queue(annual))
        ceo_action = workflow.actions.get(metadata__legacy_signature="ceo")
        self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("approved", ""))
        self.assertEqual(ceo_action.metadata["original_to_stage"], "hr_completion")
        annual.refresh_from_db()
        snapshot = get_workflow_snapshot_read_only(annual)
        self.assertEqual((snapshot["status"], snapshot["current_stage"]), ("approved", ""))
        self.assertEqual(_hr_completion_history(snapshot), [])

        # A later sync keeps the CEO-final projection.
        sync_workflow(annual)
        workflow.refresh_from_db()
        self.assertEqual(workflow.status, WorkflowInstance.Status.APPROVED)
        self.assertFalse(workflow.actions.filter(to_stage="hr_completion").exists())

        self.assertTrue(self._in_hr_queue(travel))
        self.assertEqual(self._workflow(travel).current_stage, "hr_completion")

    def test_records_ceo_final_action_when_projection_lacks_it(self):
        missing_action = self._legacy_pending()
        self._workflow(missing_action).actions.filter(metadata__legacy_signature="ceo").delete()
        missing_workflow = self._legacy_pending(reason="No projection")
        self._workflow(missing_workflow).delete()

        self._run_migration()

        ceo_action = self._workflow(missing_action).actions.get(metadata__legacy_signature="ceo")
        self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("approved", ""))
        self.assertEqual(ceo_action.actor, self.ceo_user)
        self.assertEqual(ceo_action.created_at, missing_action.ceo_decision_at)

        missing_workflow.refresh_from_db()
        self.assertEqual(missing_workflow.status, Status.APPROVED)
        workflow = sync_workflow(missing_workflow)
        self.assertEqual(workflow.status, WorkflowInstance.Status.APPROVED)
        ceo_action = workflow.actions.get(metadata__legacy_signature="ceo")
        self.assertEqual((ceo_action.to_status, ceo_action.to_stage), ("approved", ""))
