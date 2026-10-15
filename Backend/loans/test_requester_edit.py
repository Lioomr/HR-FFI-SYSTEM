"""Employee edit of their own loan request while it waits on the manager."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

from audit.models import AuditLog
from core.models import WorkflowAction
from core.services import get_workflow_snapshot
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from rest_framework.test import APITestCase

from loans.models import LoanRequest, LoanWorkflowConfig
from loans.serializers import LoanRequestReadSerializer
from loans.services import (
    NOT_REQUESTER_EDITABLE_MESSAGE,
    LoanTransitionError,
    apply_manager_recommendation,
    apply_requester_edit,
)

User = get_user_model()
Status = LoanRequest.RequestStatus
BASE = "/api/loans/loan-requests/"
EMPLOYEE_BASE = "/api/loans/employee/loan-requests/"
DISPATCH = "in_app_notifications.dispatcher.dispatch_notification_channels"


class LoanRequesterEditTests(APITestCase):
    def setUp(self):
        groups = {name: Group.objects.get_or_create(name=name)[0] for name in ("Employee", "Manager", "HRManager")}
        self.company = OrganizationNode.objects.create(
            code="LOAN_EDIT_TEST", name="Loan Edit Test Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        LoanWorkflowConfig.objects.create(require_manager_stage=True, is_active=True)
        self.manager, self.manager_profile = self._user("loan-edit-manager@ffi.test", "LE-MGR", groups["Manager"])
        self.employee, self.profile = self._user(
            "loan-edit-employee@ffi.test", "LE-EMP", groups["Employee"], manager_profile=self.manager_profile
        )
        self.coworker, _ = self._user(
            "loan-edit-coworker@ffi.test", "LE-CO", groups["Employee"], manager_profile=self.manager_profile
        )
        self.hr_user, _ = self._user("loan-edit-hr@ffi.test", "LE-HR", groups["HRManager"])
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

    def _user(self, email, employee_id, group, **profile_fields):
        user = User.objects.create_user(email=email, password="password")
        user.groups.add(group)
        profile = EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            full_name=email.split("@")[0],
            basic_salary=Decimal("5000.00"),
            hire_date=date(2020, 1, 1),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            **profile_fields,
        )
        return user, profile

    def _submit(self, **body):
        self.client.force_authenticate(user=self.employee)
        response = self.client.post(BASE, {"amount": "1000.00", "reason": "School fees", **body}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return LoanRequest.objects.get(pk=response.data["data"]["id"])

    def _edit(self, instance, body, user=None):
        self.client.force_authenticate(user=user or self.employee)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.patch(f"{BASE}{instance.pk}/edit/", body, format="json")

    def _edits(self, instance):
        return WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(LoanRequest),
            workflow__object_id=instance.pk,
            action=WorkflowAction.Action.EDIT,
        )

    def test_owner_edits_a_loan_waiting_on_the_manager(self):
        instance = self._submit()
        self.assertEqual(instance.status, Status.PENDING_MANAGER)

        with patch(DISPATCH) as dispatch:
            response = self._edit(instance, {"amount": "1200.00", "reason": "Medical bills"})

        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual((data["requested_amount"], data["status"]), ("1200.00", Status.PENDING_MANAGER))
        self.assertEqual((data["workflow"]["can_edit"], data["workflow"]["can_cancel"]), (True, True))
        self.assertEqual(data["workflow"]["history"][-1]["action"], "edit")
        instance.refresh_from_db()
        self.assertEqual((instance.requested_amount, instance.reason), (Decimal("1200.00"), "Medical bills"))
        self.assertIsNone(instance.approved_amount)

        edit = self._edits(instance).get()
        self.assertEqual((edit.actor, edit.approver_role, edit.note), (self.employee, "", "Edited: amount, reason"))
        self.assertEqual(edit.metadata["changed_fields"], ["amount", "reason"])
        log = AuditLog.objects.get(action="loan_request_edited", entity_id=str(instance.pk))
        self.assertEqual(log.metadata["changed_fields"], ["amount", "reason"])
        self.assertEqual(log.metadata["from_status"], Status.PENDING_MANAGER)
        self.assertNotIn("Medical bills", str(log.metadata))

        (call,) = dispatch.call_args_list
        self.assertEqual((call.kwargs["recipient"], call.kwargs["event_key"]), (self.manager, "loan.updated"))
        self.assertEqual(call.kwargs["action_url"], f"/manager/loan-requests/{instance.pk}")
        self.assertFalse(call.kwargs["whatsapp_enabled"])

    def test_unchanged_body_records_nothing(self):
        instance = self._submit()

        with patch(DISPATCH) as dispatch:
            response = self._edit(instance, {"amount": "1000.00", "reason": "School fees"})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(self._edits(instance).exists())
        self.assertFalse(AuditLog.objects.filter(action="loan_request_edited").exists())
        self.assertFalse(dispatch.called)

    def test_loan_past_the_manager_stage_cannot_be_edited(self):
        decided_at = timezone.now()
        closed = (
            Status.PENDING_HR,
            Status.PENDING_FINANCE,
            Status.PENDING_CFO,
            Status.PENDING_CEO,
            Status.PENDING_DISBURSEMENT,
            Status.APPROVED,
            Status.REJECTED,
            Status.CANCELLED,
            Status.DEDUCTED,
        )
        for current in closed:
            with self.subTest(status=current):
                instance = self._submit()
                LoanRequest.objects.filter(pk=instance.pk).update(status=current)
                instance.refresh_from_db()
                self.assertFalse(get_workflow_snapshot(instance, actor=self.employee)["can_edit"])

                response = self._edit(instance, {"amount": "900.00"})

                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.data["errors"], [NOT_REQUESTER_EDITABLE_MESSAGE])
                instance.refresh_from_db()
                self.assertEqual(instance.requested_amount, Decimal("1000.00"))
                self.assertFalse(self._edits(instance).exists())

        # Still pending_manager but a decision is already recorded on the row.
        instance = self._submit()
        LoanRequest.objects.filter(pk=instance.pk).update(manager_decision_at=decided_at)
        instance.refresh_from_db()
        self.assertFalse(get_workflow_snapshot(instance, actor=self.employee)["can_edit"])
        self.assertEqual(self._edit(instance, {"amount": "900.00"}).status_code, 422)

    def test_loan_that_started_at_hr_is_not_editable(self):
        self.profile.manager_profile = None
        self.profile.save(update_fields=["manager_profile"])
        instance = self._submit()
        self.assertEqual(instance.status, Status.PENDING_HR)

        self.assertFalse(get_workflow_snapshot(instance, actor=self.employee)["can_edit"])
        self.assertEqual(self._edit(instance, {"amount": "900.00"}).status_code, 422)

    def test_only_the_owner_can_edit(self):
        instance = self._submit()

        for user in (self.manager, self.hr_user, self.coworker):
            with self.subTest(user=user.email):
                self.assertFalse(get_workflow_snapshot(instance, actor=user)["can_edit"])
                self.assertEqual(self._edit(instance, {"amount": "900.00"}, user=user).status_code, 404)
        self.assertEqual(self.client.patch(f"{BASE}999999/edit/", {}, format="json").status_code, 404)

        with self.assertRaises(LoanTransitionError) as refused:
            apply_requester_edit(instance, actor=self.manager, validate=lambda locked: {})
        self.assertEqual(refused.exception.status, 403)
        instance.refresh_from_db()
        self.assertEqual(instance.requested_amount, Decimal("1000.00"))

    def test_flags_follow_the_viewer_in_detail_and_list(self):
        instance = self._submit()

        self.client.force_authenticate(user=self.employee)
        detail = self.client.get(f"{EMPLOYEE_BASE}{instance.pk}/").data["data"]
        listed = self.client.get(EMPLOYEE_BASE).data["data"]["items"]
        self.assertTrue(detail["workflow"]["can_edit"])
        self.assertTrue(listed[0]["workflow"]["can_edit"])
        self.client.force_authenticate(user=self.manager)
        manager_view = self.client.get(f"/api/loans/manager/loan-requests/{instance.pk}/").data["data"]
        self.assertFalse(manager_view["workflow"]["can_edit"])
        self.assertFalse(get_workflow_snapshot(instance, actor=self.hr_user)["can_edit"])

    def test_create_rules_are_rechecked_on_the_merged_loan(self):
        instance = self._submit()

        over_open_limit = self._edit(instance, {"amount": "1300.00"})
        self.assertEqual(over_open_limit.status_code, 422)
        self.assertEqual(over_open_limit.data["errors"][0]["field"], "amount")
        months_on_open = self._edit(instance, {"installment_months": 3})
        self.assertEqual(months_on_open.status_code, 422)
        self.assertEqual(months_on_open.data["errors"][0]["field"], "installment_months")
        missing_months = self._edit(instance, {"loan_type": "installment"})
        self.assertEqual(missing_months.data["errors"][0]["field"], "installment_months")
        over_salary = self._edit(instance, {"loan_type": "installment", "installment_months": 5, "amount": "6000"})
        self.assertEqual(over_salary.status_code, 422)
        too_many_months = self._edit(instance, {"loan_type": "installment", "installment_months": 11})
        self.assertEqual(too_many_months.data["errors"][0]["field"], "installment_months")
        negative = self._edit(instance, {"amount": "-5"})
        self.assertEqual(negative.data["errors"][0]["field"], "amount")
        server_field = self._edit(instance, {"employee_profile": 1, "status": "approved"})
        self.assertEqual(server_field.status_code, 422)
        self.assertEqual({item["field"] for item in server_field.data["errors"]}, {"employee_profile", "status"})

        instance.refresh_from_db()
        self.assertEqual(
            (instance.requested_amount, instance.loan_type, instance.installment_months, instance.status),
            (Decimal("1000.00"), "open", None, Status.PENDING_MANAGER),
        )
        self.assertFalse(self._edits(instance).exists())

    def test_switching_loan_type_both_ways(self):
        instance = self._submit()

        to_installment = self._edit(instance, {"loan_type": "installment", "installment_months": 4, "amount": "4000"})
        self.assertEqual(to_installment.status_code, 200, to_installment.data)
        instance.refresh_from_db()
        self.assertEqual((instance.loan_type, instance.installment_months), ("installment", 4))
        self.assertEqual(self._edits(instance).get().note, "Edited: amount, loan_type, installment_months")

        # Back to open: the stored installment count is dropped, the open limit applies again.
        too_much_for_open = self._edit(instance, {"loan_type": "open"})
        self.assertEqual(too_much_for_open.data["errors"][0]["field"], "amount")
        back = self._edit(instance, {"loan_type": "open", "amount": "1250"})
        self.assertEqual(back.status_code, 200, back.data)
        instance.refresh_from_db()
        self.assertEqual(
            (instance.loan_type, instance.installment_months, instance.status), ("open", None, "pending_manager")
        )

    def test_other_open_loans_do_not_block_editing(self):
        instance = self._submit()
        self._submit(amount="500.00")

        response = self._edit(instance, {"amount": "1100.00"})

        self.assertEqual(response.status_code, 200, response.data)

    def test_notification_failure_never_breaks_the_edit(self):
        instance = self._submit()

        with patch(DISPATCH, side_effect=RuntimeError("down")):
            response = self._edit(instance, {"amount": "1100.00"})

        self.assertEqual(response.status_code, 200, response.data)
        instance.refresh_from_db()
        self.assertEqual(instance.requested_amount, Decimal("1100.00"))

    def test_edit_racing_an_approval_is_refused_under_the_lock(self):
        instance = self._submit()
        stale = LoanRequest.objects.get(pk=instance.pk)  # read before the manager decides

        apply_manager_recommendation(instance, actor=self.manager, recommendation=LoanRequest.Recommendation.APPROVE)

        def validate(locked):
            raise AssertionError("a decided loan must be refused before validation")

        with self.assertRaises(LoanTransitionError) as refused:
            apply_requester_edit(stale, actor=self.employee, validate=validate)
        self.assertEqual(refused.exception.status, 422)
        stale.refresh_from_db()
        self.assertEqual((stale.status, stale.requested_amount), (Status.PENDING_HR, Decimal("1000.00")))
        self.assertFalse(self._edits(stale).exists())

    def test_edit_flag_adds_no_queries_to_list_serialization(self):
        request = type("Request", (), {"user": self.employee})()

        def serialize():
            instances = list(
                LoanRequest.objects.filter(employee=self.employee).select_related(
                    "employee",
                    "employee_profile",
                    "company",
                    "manager_decision_by",
                    "finance_decision_by",
                    "cfo_decision_by",
                    "ceo_decision_by",
                    "disbursed_by",
                )
            )
            with CaptureQueriesContext(connection) as queries:
                rows = LoanRequestReadSerializer(instances, many=True, context={"request": request}).data
            return rows, len(queries)

        for _ in range(3):
            self._submit()
        serialize()  # warm the workflow projection
        rows, with_flag = serialize()
        with patch("core.services.workflow_engine._requester_can_edit", return_value=False):
            _, without_flag = serialize()

        self.assertTrue(all(row["workflow"]["can_edit"] for row in rows))
        self.assertEqual(with_flag, without_flag)
